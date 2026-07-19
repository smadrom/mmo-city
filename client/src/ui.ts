import {
  DOOR_DIST, CAR_ENTER_DIST, DELIVERY_PICKUP_DIST, RENT_PRICE,
  WEAPONS, AMMO_PACK_PRICE, AMMO_PACK_SIZE,
  dist2, type CityMap, type WeaponKind,
} from '@mmo/shared';
import type { Room } from 'colyseus.js';
import type { Avatars } from './avatars.js';

export class UI {
  private stats = document.getElementById('stats')!;
  private banner = document.getElementById('banner')!;
  private prompt = document.getElementById('prompt')!;
  private safeDialog = document.getElementById('safeDialog')!;
  private shopDialog = document.getElementById('shopDialog')!;
  private toast = document.getElementById('toast')!;
  private toastTimer = 0;

  constructor(private room: Room, private map: CityMap, private avatars: Avatars) {
    room.onMessage('openSafe', () => this.safeDialog.classList.remove('hidden'));
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

    room.onMessage('openShop', () => this.shopDialog.classList.remove('hidden'));
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
  }

  private me(): any {
    return (this.room.state.players as any).get(this.room.sessionId);
  }

  private showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.add('hidden'), 2000);
  }

  update(): void {
    const me = this.me();
    if (!me) return;
    const nowServer = this.avatars.serverNow();

    const roleRu = me.role === 'cop' ? 'Полицейский' : 'Гражданин';
    const w = me.weapon && Object.hasOwn(WEAPONS, me.weapon) ? WEAPONS[me.weapon as WeaponKind] : null;
    const weaponLine = `Оружие: ${w ? w.name : 'Кулаки'}${w?.ranged ? ` · ${me.ammo}` : ''}`;
    this.stats.textContent =
      `HP: ${Math.ceil(me.hp)}  |  Наличные: ${me.cash}$  |  Сейф: ${me.safe}$\n` +
      `${roleRu}${me.apt ? `  |  Квартира: ${me.apt}` : ''}\n` +
      weaponLine;

    // Баннеры
    let bannerText = '';
    if (me.mode === 'jail') {
      bannerText = `ТЮРЬМА: ${Math.max(0, Math.ceil((me.jailUntil - nowServer) / 1000))} сек`;
    } else if (me.wantedUntil > nowServer) {
      bannerText = `В РОЗЫСКЕ: ${Math.ceil((me.wantedUntil - nowServer) / 1000)} сек`;
    } else if (me.cargo) {
      bannerText = `Груз → ${me.deliveryTarget}: ${Math.max(0, Math.ceil((me.deliveryDeadline - nowServer) / 1000))} сек`;
    } else if (me.mode === 'dead') {
      bannerText = 'Вы погибли. Респаун...';
    }
    this.banner.textContent = bannerText;
    this.banner.classList.toggle('hidden', bannerText === '');

    this.prompt.textContent = this.computePrompt(me);
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
