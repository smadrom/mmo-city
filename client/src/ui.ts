import {
  DOOR_DIST, CAR_ENTER_DIST, DELIVERY_PICKUP_DIST, RENT_PRICE,
  WEAPONS, AMMO_PACK_PRICE, AMMO_PACK_SIZE, CHAT_MAX_LEN, TARGET_LABELS,
  dist2, type CityMap, type WeaponKind,
} from '@mmo/shared';
import type { Room } from 'colyseus.js';
import type { Avatars } from './avatars.js';
import type { InputController } from './input.js';

export class UI {
  private stats = document.getElementById('stats')!;
  private banner = document.getElementById('banner')!;
  private prompt = document.getElementById('prompt')!;
  private safeDialog = document.getElementById('safeDialog')!;
  private shopDialog = document.getElementById('shopDialog')!;
  private toast = document.getElementById('toast')!;
  private toastTimer = 0;
  private chat = document.getElementById('chat')!;
  private chatInput = document.getElementById('chatInput') as HTMLInputElement;
  private crosshair = document.getElementById('crosshair')!;
  private seenChat = new Set<string>();
  private seenChatQueue: string[] = [];

  constructor(private room: Room, private map: CityMap, private avatars: Avatars, private input: InputController) {
    this.chatInput.maxLength = CHAT_MAX_LEN; // лимит из общего конфига, не из HTML
    room.onMessage('openSafe', () => {
      document.exitPointerLock(); // иначе клики не доходят до кнопок под захватом мыши
      this.safeDialog.classList.remove('hidden');
    });
    document.getElementById('safeClose')!.addEventListener('click', () => this.safeDialog.classList.add('hidden'));
    document.getElementById('dep100')!.addEventListener('click', () => room.send('deposit', { amount: 100 }));
    document.getElementById('depAll')!.addEventListener('click', () => {
      const me = this.me();
      if (me) room.send('deposit', { amount: me.cash });
    });
    document.getElementById('wd100')!.addEventListener('click', () => room.send('withdraw', { amount: 100 }));
    document.getElementById('wdAll')!.addEventListener('click', () => {
      const me = this.me();
      if (me) room.send('withdraw', { amount: me.safe });
    });
    // кнопка сохраняет фокус после клика — снимаем его, чтобы Space/Enter
    // не повторяли последнее действие (в диалоге нет текстовых полей)
    this.safeDialog.addEventListener('click', (e) => (e.target as HTMLElement).blur());

    room.onMessage('openShop', () => {
      document.exitPointerLock();
      this.shopDialog.classList.remove('hidden');
    });
    room.onMessage('shopResult', (msg: any) => {
      const texts: Record<string, string> = {
        ok: 'Куплено', too_far: 'Подойди ближе к магазину',
        no_money: 'Не хватает денег', bad_kind: 'Нет такого оружия',
      };
      this.showToast(texts[msg.reason] ?? 'Ошибка покупки');
    });
    const items = document.getElementById('shopItems')!;
    for (const kind of Object.keys(WEAPONS) as WeaponKind[]) {
      const w = WEAPONS[kind];
      const row = document.createElement('div');
      row.className = 'shopRow';
      const label = document.createElement('span');
      label.textContent = `${w.name} — урон ${w.damage}, дальность ${w.range} м`;
      const btn = document.createElement('button');
      btn.textContent = `${w.price}$`;
      btn.addEventListener('click', () => room.send('buyWeapon', { kind }));
      row.append(label, btn);
      items.append(row);
    }
    document.getElementById('buyAmmoBtn')!.textContent = `Патроны +${AMMO_PACK_SIZE} (${AMMO_PACK_PRICE}$)`;
    document.getElementById('buyAmmoBtn')!.addEventListener('click', () => room.send('buyAmmo'));
    document.getElementById('shopClose')!.addEventListener('click', () => this.shopDialog.classList.add('hidden'));
    this.shopDialog.addEventListener('click', (e) => (e.target as HTMLElement).blur());

    room.onMessage('chat', (msg: any) => this.appendChat(msg));
    room.onMessage('chatHistory', (h: any) => {
      for (const msg of h.items) this.appendChat(msg);
    });
    room.send('chatHistoryReq');

    // Enter вне поля — открыть ввод (pointer lock снимаем, иначе фокус не уйти)
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return; // зажатый Enter не переоткрывает чат автоповтором
      if (e.code === 'Enter' && document.activeElement !== this.chatInput) {
        e.preventDefault();
        document.exitPointerLock();
        this.chatInput.classList.remove('hidden');
        this.chatInput.focus();
      }
    });
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation(); // клавиши не доходят до InputController
      if (e.code === 'Enter') {
        const text = this.chatInput.value.trim();
        if (text) room.send('chat', { text });
        this.closeChat();
      } else if (e.code === 'Escape') {
        this.closeChat();
      }
    });
  }

  private appendChat(msg: { from: string; text: string; t?: number }): void {
    // гонка история/лайв (~1 RTT): одно и то же сообщение может прийти дважды —
    // в live-broadcast и в ответе на chatHistoryReq; дедуп по from+text+t
    const key = `${msg.from}${msg.t ?? ''}${msg.text}`;
    if (this.seenChat.has(key)) return;
    this.seenChat.add(key);
    this.seenChatQueue.push(key);
    if (this.seenChatQueue.length > 500) this.seenChat.delete(this.seenChatQueue.shift()!);
    const atBottom = this.chat.scrollTop + this.chat.clientHeight >= this.chat.scrollHeight - 10;
    const div = document.createElement('div');
    div.textContent = `${msg.from}: ${msg.text}`; // textContent — без XSS
    this.chat.append(div);
    if (atBottom) this.chat.scrollTop = this.chat.scrollHeight;
  }

  private closeChat(): void {
    this.chatInput.value = '';
    this.chatInput.classList.add('hidden');
    this.chatInput.blur();
  }

  private me(): any {
    return (this.room.state.players as any).get(this.room.sessionId);
  }

  showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.add('hidden'), 2000);
  }

  update(): void {
    const me = this.me();
    if (!me) return;
    const nowServer = this.avatars.serverNow();

    const dialogsClosed = this.safeDialog.classList.contains('hidden')
      && this.shopDialog.classList.contains('hidden')
      && this.chatInput.classList.contains('hidden');
    const showCross = this.input.aiming && document.pointerLockElement !== null
      && me.mode !== 'dead' && dialogsClosed;
    this.crosshair.classList.toggle('hidden', !showCross);

    const roleRu = me.role === 'cop' ? 'Полицейский' : 'Гражданин';
    const w = me.weapon && Object.hasOwn(WEAPONS, me.weapon) ? WEAPONS[me.weapon as WeaponKind] : null;
    const weaponLine = `Оружие: ${w ? w.name : 'Кулаки'}${w?.ranged ? ` · ${me.ammo}` : ''}`;
    this.stats.textContent =
      `HP: ${Math.ceil(me.hp)}  |  Наличные: ${me.cash}$  |  Сейф: ${me.safe}$\n` +
      `${roleRu}${me.apt ? `  |  Квартира: ${me.apt}` : ''}\n` +
      weaponLine;

    // Баннеры: все активные строки сразу (например, розыск + груз одновременно)
    const lines: string[] = [];
    if (me.mode === 'jail') {
      lines.push(`ТЮРЬМА: ${Math.max(0, Math.ceil((me.jailUntil - nowServer) / 1000))} сек`);
    }
    if (me.wantedUntil > nowServer) {
      lines.push(`В РОЗЫСКЕ: ${Math.ceil((me.wantedUntil - nowServer) / 1000)} сек`);
    }
    if (me.cargo) {
      const target = TARGET_LABELS[me.deliveryTarget] ?? me.deliveryTarget;
      lines.push(`Груз → ${target}: ${Math.max(0, Math.ceil((me.deliveryDeadline - nowServer) / 1000))} сек`);
    }
    if (me.mode === 'dead') lines.push('Вы погибли. Респаун...');
    this.banner.textContent = lines.join('\n');
    this.banner.classList.toggle('hidden', lines.length === 0);

    // авто-закрытие диалогов: отошёл от двери/магазина, сел в машину или умер
    if (!this.safeDialog.classList.contains('hidden') && !this.nearOwnDoor(me)) {
      this.safeDialog.classList.add('hidden');
    }
    if (!this.shopDialog.classList.contains('hidden') &&
        !(me.mode === 'foot' && dist2(me.x, me.z, this.map.gunShop.x, this.map.gunShop.z) < DOOR_DIST * DOOR_DIST)) {
      this.shopDialog.classList.add('hidden');
    }

    this.prompt.textContent = this.computePrompt(me);
  }

  private nearOwnDoor(me: any): boolean {
    if (me.mode !== 'foot') return false;
    for (const [, apt] of (this.room.state.apartments as any)) {
      if (apt.rentedBy === me.name && dist2(me.x, me.z, apt.doorX, apt.doorZ) < DOOR_DIST * DOOR_DIST) return true;
    }
    return false;
  }

  private computePrompt(me: any): string {
    if (me.mode === 'car') {
      if (!me.cargo && dist2(me.x, me.z, this.map.warehouse.x, this.map.warehouse.z) < DELIVERY_PICKUP_DIST ** 2) {
        return 'E — взять груз';
      }
      return 'E — выйти из машины';
    }
    if (me.mode !== 'foot') return '';

    if (dist2(me.x, me.z, this.map.gunShop.x, this.map.gunShop.z) < DOOR_DIST * DOOR_DIST) {
      return 'E — оружейный магазин';
    }

    for (const [, apt] of (this.room.state.apartments as any)) {
      if (dist2(me.x, me.z, apt.doorX, apt.doorZ) < DOOR_DIST * DOOR_DIST) {
        return apt.rentedBy === me.name ? 'E — сейф' : `E — аренда ${RENT_PRICE}$`;
      }
    }
    for (const [, car] of (this.room.state.cars as any)) {
      if (!car.driverId && dist2(me.x, me.z, car.x, car.z) < CAR_ENTER_DIST * CAR_ENTER_DIST) {
        return 'E — сесть в машину';
      }
    }
    return '';
  }
}
