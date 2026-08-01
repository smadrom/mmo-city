import {
  DOOR_DIST, CAR_ENTER_DIST, DELIVERY_PICKUP_DIST, RENT_PRICE, MAX_HP,
  WEAPONS, AMMO_PACK_PRICE, AMMO_PACK_SIZE, CHAT_MAX_LEN,
  RESPAWN_DELAY_MS,
  deliveryReward, dist2, type CityMap, type WeaponKind,
} from '@mmo/shared';
import type { Room } from 'colyseus.js';
import type { Avatars } from './avatars.js';
import type { InputController } from './input.js';
import { t } from './i18n/index.js';

export class UI {
  private stats = document.getElementById('stats')!;
  private hpfill = document.getElementById('hpfill')!;
  private hptext = document.getElementById('hptext')!;
  private ammoBig = document.getElementById('ammoBig')!;
  private deathOverlay = document.getElementById('deathOverlay')!;
  private deathTimer = document.getElementById('deathTimer')!;
  private diedAt = 0; // performance.now() входа в mode='dead' — отсчёт респавна
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
    document.getElementById('safeClose')!.addEventListener('click', () => this.closeDialogs());
    // this.room, а не параметр: после реконнекта кнопки шлют в новую комнату
    document.getElementById('dep100')!.addEventListener('click', () => this.room.send('deposit', { amount: 100 }));
    document.getElementById('depAll')!.addEventListener('click', () => {
      const me = this.me();
      if (me) this.room.send('deposit', { amount: me.cash });
    });
    document.getElementById('wd100')!.addEventListener('click', () => this.room.send('withdraw', { amount: 100 }));
    document.getElementById('wdAll')!.addEventListener('click', () => {
      const me = this.me();
      if (me) this.room.send('withdraw', { amount: me.safe });
    });
    // кнопка сохраняет фокус после клика — снимаем его, чтобы Space/Enter
    // не повторяли последнее действие (в диалоге нет текстовых полей)
    this.safeDialog.addEventListener('click', (e) => (e.target as HTMLElement).blur());

    const items = document.getElementById('shopItems')!;
    for (const kind of Object.keys(WEAPONS) as WeaponKind[]) {
      const w = WEAPONS[kind];
      const row = document.createElement('div');
      row.className = 'shopRow';
      const label = document.createElement('span');
      label.textContent = t('shop.row', { name: t(`weapon.${kind}`), dmg: w.damage, range: w.range });
      const btn = document.createElement('button');
      btn.textContent = `${w.price}$`;
      btn.addEventListener('click', () => this.room.send('buyWeapon', { kind }));
      row.append(label, btn);
      items.append(row);
    }
    document.getElementById('buyAmmoBtn')!.textContent = t('dialog.ammo', { size: AMMO_PACK_SIZE, price: AMMO_PACK_PRICE });
    document.getElementById('buyAmmoBtn')!.addEventListener('click', () => this.room.send('buyAmmo'));
    document.getElementById('shopClose')!.addEventListener('click', () => this.closeDialogs());
    this.shopDialog.addEventListener('click', (e) => (e.target as HTMLElement).blur());

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
        if (text) this.room.send('chat', { text });
        this.closeChat();
      } else if (e.code === 'Escape') {
        this.closeChat();
      }
    });
    // Esc обрабатывает центральный диспетчер в main.ts — здесь слушателя нет

    this.bind(room);
  }

  // реконнект: сообщения подписываем на новую комнату (DOM-слушатели остаются в конструкторе)
  bind(room: Room): void {
    this.room = room;
    room.onMessage('openSafe', () => {
      document.exitPointerLock(); // иначе клики не доходят до кнопок под захватом мыши
      this.input.setBlocked(true); // диалог открыт — WASD/стрельбу глушим
      this.safeDialog.classList.remove('hidden');
    });
    room.onMessage('openShop', () => {
      document.exitPointerLock();
      this.input.setBlocked(true); // диалог открыт — WASD/стрельбу глушим
      this.shopDialog.classList.remove('hidden');
    });
    room.onMessage('shopResult', (msg: any) => {
      const key = `shop.${msg.reason}`;
      this.showToast(msg.ok ? t('shop.ok') : (t(key) === key ? t('shop.error') : t(key))); // неизвестный reason — общий fallback
    });
    room.onMessage('chat', (msg: any) => this.appendChat(msg));
    room.onMessage('sys', (m: { code: string; name: string; t?: number }) => {
      this.appendChat({ from: '*', text: t(`sys.${m.code}`, { name: m.name }), t: m.t });
    });
    room.onMessage('chatHistory', (h: any) => {
      for (const msg of h.items) this.appendChat(msg);
    });
    room.send('chatHistoryReq'); // история перезапрашивается и после реконнекта — дедуп в appendChat
  }

  // единая точка закрытия диалогов: прячет оба и возвращает управление
  // публичный: дёргает центральный Esc-диспетчер в main.ts
  closeDialogs(): void {
    const wasOpen = !this.safeDialog.classList.contains('hidden') || !this.shopDialog.classList.contains('hidden');
    this.safeDialog.classList.add('hidden');
    this.shopDialog.classList.add('hidden');
    if (wasOpen) this.input.setBlocked(false); // диалог закрыт — управление вернуть
  }

  // открыт ли сейф/магазин — для Esc-диспетчера в main.ts
  dialogsOpen(): boolean {
    return !this.safeDialog.classList.contains('hidden') || !this.shopDialog.classList.contains('hidden');
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
    if (msg.from === '*') {
      div.textContent = msg.text; // системное: без «от кого», курсивом
      div.className = 'sysMsg';
      this.chat.append(div);
      if (atBottom) this.chat.scrollTop = this.chat.scrollHeight;
      return;
    }
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

    const k = Math.max(0, Math.min(1, me.hp / MAX_HP));
    this.hpfill.style.width = `${k * 100}%`;
    // цвет бара: зелёный → жёлтый → красный по мере потери HP
    (this.hpfill.style as any).background = k > 0.5 ? '#33cc33' : k > 0.25 ? '#ddaa22' : '#cc2222';
    this.hptext.textContent = `${Math.ceil(me.hp)}`;
    const roleRu = t(me.role === 'cop' ? 'role.cop' : 'role.citizen');
    const w = me.weapon && Object.hasOwn(WEAPONS, me.weapon) ? WEAPONS[me.weapon as WeaponKind] : null;
    this.ammoBig.classList.toggle('hidden', !w?.ranged);
    if (w?.ranged) this.ammoBig.textContent = `▸ ${me.ammo}`;
    this.stats.textContent =
      `${t('stats.cash')}: ${me.cash}$  |  ${t('stats.safe')}: ${me.safe}$\n` +
      `${roleRu}${me.apt ? `  |  ${t('stats.apt')}: ${me.apt}` : ''}\n` +
      `${t('stats.weapon')}: ${w ? t(`weapon.${me.weapon}`) : t('stats.fists')}`;

    // Баннеры: все активные строки сразу (например, розыск + груз одновременно)
    const lines: string[] = [];
    if (me.mode === 'jail') {
      lines.push(`${t('banner.jail')}: ${Math.max(0, Math.ceil((me.jailUntil - nowServer) / 1000))}`);
    }
    if (me.wantedUntil > nowServer) {
      lines.push(`${t('banner.wanted')}: ${Math.ceil((me.wantedUntil - nowServer) / 1000)}`);
    }
    if (me.cargo) {
      lines.push(t('banner.cargo', {
        target: t(`target.${me.deliveryTarget}`),
        sec: Math.max(0, Math.ceil((me.deliveryDeadline - nowServer) / 1000)),
        reward: deliveryReward(this.map, me.deliveryTarget),
      }));
    }
    this.banner.textContent = lines.join('\n');
    this.banner.classList.toggle('hidden', lines.length === 0);

    // экран смерти с отсчётом до респавна (зомби-режимов у игрока нет — всегда RESPAWN_DELAY_MS)
    if (me.mode === 'dead') {
      if (!this.diedAt) this.diedAt = performance.now();
      const left = Math.max(0, Math.ceil((RESPAWN_DELAY_MS - (performance.now() - this.diedAt)) / 1000));
      this.deathTimer.textContent = t('death.timer', { sec: left });
      this.deathOverlay.classList.remove('hidden');
    } else {
      this.diedAt = 0;
      this.deathOverlay.classList.add('hidden');
    }

    // авто-закрытие диалогов: отошёл от двери/магазина, сел в машину или умер
    if (!this.safeDialog.classList.contains('hidden') && !this.nearOwnDoor(me)) {
      this.closeDialogs();
    }
    if (!this.shopDialog.classList.contains('hidden') &&
        !(me.mode === 'foot' && dist2(me.x, me.z, this.map.gunShop.x, this.map.gunShop.z) < DOOR_DIST * DOOR_DIST)) {
      this.closeDialogs();
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
        return t('prompt.takeCargo');
      }
      return t('prompt.exitCar');
    }
    if (me.mode !== 'foot') return '';

    if (dist2(me.x, me.z, this.map.gunShop.x, this.map.gunShop.z) < DOOR_DIST * DOOR_DIST) {
      return t('prompt.gunShop');
    }

    for (const [, apt] of (this.room.state.apartments as any)) {
      if (dist2(me.x, me.z, apt.doorX, apt.doorZ) < DOOR_DIST * DOOR_DIST) {
        return apt.rentedBy === me.name ? t('prompt.safe') : t('prompt.rent', { price: RENT_PRICE });
      }
    }
    for (const [, car] of (this.room.state.cars as any)) {
      if (!car.driverId && dist2(me.x, me.z, car.x, car.z) < CAR_ENTER_DIST * CAR_ENTER_DIST) {
        return t('prompt.enterCar');
      }
    }
    return '';
  }
}
