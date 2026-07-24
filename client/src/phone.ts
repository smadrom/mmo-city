import { SMS_HISTORY_COOLDOWN_MS, TARGET_LABELS } from '@mmo/shared';
import type { Room } from 'colyseus.js';
import { isTypingTarget, type InputController } from './input.js';

interface DialogRow { withNick: string; lastText: string; lastTs: number; unread: number }
interface SmsItem { id: number; fromNick: string; text: string; ts: number }
type Screen = 'phoneHome' | 'appSms' | 'appThread' | 'appBank' | 'appJob';

// Телефон (P): оверлей с приложениями SMS / Банк / Работа.
// Весь пользовательский текст — только textContent.
export class Phone {
  isOpen = false;
  onOpen?: () => void; // main.ts подписывает: закрыть карту
  private root = document.getElementById('phone')!;
  private screen: Screen = 'phoneHome';
  private threadWith = '';
  private threadMsgs = new Map<number, SmsItem>(); // тред целиком: дедуп live/история по id строки БД
  private pendingThread = ''; // тред, чей smsThreadReq ещё не отвечен (сервер режет повторы кулдауном)
  private lastThreadReqAt = 0;
  private unread = 0;
  private me(): any { return (this.room.state.players as any).get(this.room.sessionId); }
  private meName(): string { return this.me()?.name ?? ''; }

  constructor(
    private room: Room,
    private input: InputController,
    private toast: (t: string) => void,
    private serverNow: () => number,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || isTypingTarget()) return;
      if (e.code === 'KeyP') this.isOpen ? this.close() : this.open();
      else if (e.code === 'Escape' && this.isOpen) this.close();
    });
    this.root.querySelectorAll('.phoneApp').forEach(b =>
      b.addEventListener('click', () => this.openApp((b as HTMLElement).dataset.app!)));
    this.root.querySelectorAll('.phoneBack').forEach(b =>
      b.addEventListener('click', () => this.show('phoneHome')));

    // SMS
    document.getElementById('smsNew')!.addEventListener('click', () =>
      document.getElementById('smsNewForm')!.classList.toggle('hidden'));
    document.getElementById('smsNewGo')!.addEventListener('click', () => {
      const nick = (document.getElementById('smsNewTo') as HTMLInputElement).value.trim();
      if (nick) this.openThread(nick);
    });
    document.getElementById('threadSend')!.addEventListener('click', () => this.sendSms());
    document.getElementById('threadInput')!.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter') this.sendSms();
    });
    // Банк
    document.getElementById('transferBtn')!.addEventListener('click', () => {
      const to = (document.getElementById('transferTo') as HTMLInputElement).value.trim();
      const amount = Number((document.getElementById('transferAmount') as HTMLInputElement).value);
      room.send('transfer', { to, amount });
    });
    // Работа
    document.getElementById('jobBtn')!.addEventListener('click', () => {
      const me = this.me();
      room.send(me?.cargo ? 'jobDrop' : 'jobTake');
    });

    // Сеть
    room.onMessage('smsInbox', (m: any) => { this.unread = m.unread; this.renderBadge(); });
    room.onMessage('sms', (m: any) => this.onSms(m));
    room.onMessage('smsResult', (m: any) => {
      if (!m.ok) this.toast(this.smsErrorText(m.error));
    });
    room.onMessage('smsHistory', (m: any) => this.renderDialogs(m.dialogs));
    room.onMessage('smsThread', (m: any) => {
      if (m.with !== this.threadWith) return;
      for (const item of m.items) this.threadMsgs.set(item.id, item); // merge: live-смс между запросом и ответом не затираются
      this.renderThread();
      if (m.with === this.pendingThread) this.pendingThread = '';
      // прочитанным помечаем только когда история реально показана
      this.room.send('smsRead', { with: this.threadWith });
    });
    room.onMessage('transferResult', (m: any) => {
      this.toast(m.ok ? 'Переведено' : this.transferErrorText(m.error));
      if (m.ok) {
        (document.getElementById('transferTo') as HTMLInputElement).value = '';
        (document.getElementById('transferAmount') as HTMLInputElement).value = '';
        room.send('transferHistoryReq');
      }
    });
    room.onMessage('transferIn', (m: any) => this.toast(`Перевод от ${m.from}: +${m.amount}$`));
    room.onMessage('transferHistory', (m: any) => this.renderTransfers(m.items));
    room.onMessage('jobResult', (m: any) => {
      if (!m.ok) this.toast(m.error === 'need_car' ? 'Нужно быть в машине' : 'Нет активного заказа');
    });
  }

  open(): void {
    this.isOpen = true;
    this.onOpen?.();
    document.exitPointerLock();
    this.input.setBlocked(true);
    this.root.classList.remove('hidden');
    this.show('phoneHome');
    this.unread = 0;
    this.renderBadge();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.input.setBlocked(false);
    this.root.classList.add('hidden');
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  update(): void {
    if (!this.isOpen) return;
    // сервер молча роняет smsThreadReq чаще раза в кулдаун — догружаем тред после него
    if (this.pendingThread && Date.now() - this.lastThreadReqAt >= SMS_HISTORY_COOLDOWN_MS) this.requestThread();
    const me = this.me();
    if (!me) return;
    // часы
    const d = new Date(this.serverNow());
    document.getElementById('phoneClock')!.textContent =
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    // работа
    const info = document.getElementById('jobInfo')!;
    const btn = document.getElementById('jobBtn')!;
    if (me.cargo) {
      const target = TARGET_LABELS[me.deliveryTarget] ?? me.deliveryTarget;
      const left = Math.max(0, Math.ceil((me.deliveryDeadline - this.serverNow()) / 1000));
      info.textContent = `Заказ: груз → ${target}. Осталось ${left} сек. Сдача — доехать до точки на машине.`;
      btn.textContent = 'Отказаться от заказа';
    } else {
      info.textContent = me.mode === 'car'
        ? 'Заказа нет. Взять доставку можно прямо отсюда (машина у тебя).'
        : 'Заказа нет. Для доставки нужна машина.';
      btn.textContent = 'Взять заказ';
    }
    // банк
    document.getElementById('bankBalance')!.textContent = `Наличные: ${me.cash}$`;
  }

  private show(s: Screen): void {
    this.screen = s;
    for (const id of ['phoneHome', 'appSms', 'appThread', 'appBank', 'appJob'] as Screen[]) {
      document.getElementById(id)!.classList.toggle('hidden', id !== s);
    }
    if (s === 'appSms') this.room.send('smsHistoryReq');
    if (s === 'appBank') this.room.send('transferHistoryReq');
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private openApp(app: string): void {
    if (app === 'sms') this.show('appSms');
    else if (app === 'bank') this.show('appBank');
    else if (app === 'job') this.show('appJob');
  }

  private openThread(nick: string): void {
    this.threadWith = nick;
    document.getElementById('threadTitle')!.textContent = nick;
    document.getElementById('threadMsgs')!.textContent = '';
    this.threadMsgs.clear();
    this.show('appThread');
    this.requestThread(); // smsRead шлём только из ответа smsThread — когда история показана
  }

  private requestThread(): void {
    this.pendingThread = this.threadWith;
    this.lastThreadReqAt = Date.now();
    this.room.send('smsThreadReq', { with: this.threadWith });
  }

  private sendSms(): void {
    const input = document.getElementById('threadInput') as HTMLInputElement;
    const text = input.value.trim();
    if (!text || !this.threadWith) return;
    this.room.send('sms', { to: this.threadWith, text });
    input.value = '';
    input.focus();
  }

  private onSms(m: { id: number; from: string; to: string; text: string; ts: number }): void {
    const mine = m.from === this.meName();
    const other = mine ? m.to : m.from;
    if (!mine) this.toast(`SMS от ${m.from}`);
    if (!mine && !(this.isOpen && this.screen === 'appThread' && this.threadWith === m.from)) {
      this.unread++;
      this.renderBadge();
    }
    if (this.isOpen && this.screen === 'appThread' && this.threadWith === other) {
      this.appendMsg({ id: m.id, fromNick: m.from, text: m.text, ts: m.ts });
      if (!mine) this.room.send('smsRead', { with: m.from });
    } else if (this.isOpen && this.screen === 'appSms') {
      this.room.send('smsHistoryReq');
    }
  }

  private appendMsg(item: SmsItem): void {
    if (this.threadMsgs.has(item.id)) return;
    this.threadMsgs.set(item.id, item);
    const box = document.getElementById('threadMsgs')!;
    box.append(this.msgDiv(item));
    box.scrollTop = box.scrollHeight;
  }

  // перерисовка всего треда из карты (по возрастанию id) — дедуп уже в Map
  private renderThread(): void {
    const box = document.getElementById('threadMsgs')!;
    box.textContent = '';
    for (const item of [...this.threadMsgs.values()].sort((a, b) => a.id - b.id)) {
      box.append(this.msgDiv(item));
    }
    box.scrollTop = box.scrollHeight;
  }

  private msgDiv(item: SmsItem): HTMLDivElement {
    const div = document.createElement('div');
    div.className = item.fromNick === this.meName() ? 'msgOut' : 'msgIn';
    div.textContent = item.text;
    return div;
  }

  private renderDialogs(dialogs: DialogRow[]): void {
    const box = document.getElementById('smsDialogs')!;
    box.textContent = '';
    for (const d of dialogs) {
      const row = document.createElement('div');
      row.className = 'smsRow';
      const left = document.createElement('span');
      left.textContent = `${d.withNick}: ${d.lastText}`;
      row.append(left);
      if (d.unread > 0) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = String(d.unread);
        row.append(badge);
      }
      row.addEventListener('click', () => this.openThread(d.withNick));
      box.append(row);
    }
  }

  private renderTransfers(items: { fromNick: string; toNick: string; amount: number; ts: number }[]): void {
    const box = document.getElementById('transferList')!;
    box.textContent = '';
    for (const t of items) {
      const row = document.createElement('div');
      row.className = 'transferRow';
      const out = t.fromNick === this.meName();
      row.textContent = out ? `→ ${t.toNick}: −${t.amount}$` : `← ${t.fromNick}: +${t.amount}$`;
      box.append(row);
    }
  }

  private renderBadge(): void {
    for (const id of ['smsBadge', 'phoneSmsBadge']) {
      const el = document.getElementById(id)!;
      el.textContent = String(this.unread);
      el.classList.toggle('hidden', this.unread === 0);
    }
  }

  private smsErrorText(error: string): string {
    const texts: Record<string, string> = {
      bad_to: 'Некорректный ник', self: 'Нельзя писать себе', bad_text: 'Пустое или длинное сообщение',
      cooldown: 'Не так быстро', no_such_user: 'Нет такого игрока', muted: 'Вы замьючены',
    };
    return texts[error] ?? 'Ошибка SMS';
  }

  private transferErrorText(error: string): string {
    const texts: Record<string, string> = {
      bad_amount: 'Сумма от 1 до 100000', self: 'Нельзя себе',
      no_such_user: 'Нет такого игрока', no_money: 'Не хватает наличных',
      need_playtime: 'Переводы доступны после 30 минут игры',
      ip_limit: 'Дневной лимит переводов с вашего IP исчерпан',
    };
    return texts[error] ?? 'Ошибка перевода';
  }
}
