import { describe, it, expect } from 'vitest';
import { GameState, Player } from '../src/schema/GameState.js';
import { makeRuntime, type Runtime } from '../src/runtime.js';
import { handleAttack, killPlayer, tickRespawn } from '../src/systems/combat.js';
import { PUNCH_DAMAGE, MAX_HP, WANTED_DURATION_MS, DEATH_CASH_LOSS, RESPAWN_DELAY_MS, WEAPONS, createCityMap, ZOMBIE_DAMAGE, ZOMBIE_HP, ZOMBIE_RESPAWN_MS } from '@mmo/shared';

function setup() {
  const state = new GameState();
  const a = new Player(); a.name = 'attacker';
  const v = new Player(); v.name = 'victim';
  // жертва прямо перед атакующим (rotY=0 смотрит в -z)
  a.x = 0; a.z = 0; a.rotY = 0;
  v.x = 0; v.z = -1.5;
  state.players.set('a', a);
  state.players.set('v', v);
  const runtimes = new Map<string, Runtime>([['a', makeRuntime(0)], ['v', makeRuntime(0)]]);
  return { state, a, v, runtimes };
}

describe('бой', () => {
  it('удар наносит урон цели впереди', () => {
    const { state, v, runtimes } = setup();
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP - PUNCH_DAMAGE);
  });

  it('не бьёт цель за спиной', () => {
    const { state, v, runtimes } = setup();
    v.z = 1.5; // сзади
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP);
  });

  it('не бьёт дальше PUNCH_RANGE', () => {
    const { state, v, runtimes } = setup();
    v.z = -5;
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP);
  });

  it('кулачный кулдаун: второй удар сразу не проходит', () => {
    const { state, v, runtimes } = setup();
    handleAttack(state, runtimes, 'a', 1000, []);
    handleAttack(state, runtimes, 'a', 1100, []);
    expect(v.hp).toBe(MAX_HP - PUNCH_DAMAGE);
  });

  it('смерть: потеря 50% наличных, розыск убийцы, респаун', () => {
    const { state, a, v, runtimes } = setup();
    v.hp = PUNCH_DAMAGE;
    v.cash = 400;
    const now = 5000;
    handleAttack(state, runtimes, 'a', now, []);
    expect(v.mode).toBe('dead');
    expect(v.cash).toBe(Math.floor(400 * (1 - DEATH_CASH_LOSS)));
    expect(a.wantedUntil).toBe(now + WANTED_DURATION_MS);
    expect(runtimes.get('a')!.kills).toBe(1);
    expect(runtimes.get('v')!.deaths).toBe(1);
    // респаун без квартиры — в больнице
    const map = createCityMap();
    tickRespawn(state, runtimes, map, now + RESPAWN_DELAY_MS + 1);
    expect(v.mode).toBe('foot');
    expect(v.hp).toBe(MAX_HP);
    expect(v.x).toBe(map.hospitalDoor.x);
    expect(v.wantedUntil).toBe(0);
  });

  it('нельзя ударить из машины', () => {
    const { state, a, v, runtimes } = setup();
    a.mode = 'car';
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP);
  });

  it('бита: урон 35, дальность 2.5, кулдаун 800', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'bat';
    v.z = -2.2; // в пределах 2.5
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP - WEAPONS.bat.damage);
    handleAttack(state, runtimes, 'a', 1500, []); // кулдаун 800 не прошёл
    expect(v.hp).toBe(MAX_HP - WEAPONS.bat.damage);
  });

  it('бита не достаёт на 3 метрах', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'bat';
    v.z = -3;
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP);
  });

  it('пистолет без патронов не стреляет', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'pistol';
    a.ammo = 0;
    const shot = handleAttack(state, runtimes, 'a', 1000, []).shot;
    expect(shot).toBeNull();
    expect(a.ammo).toBe(0);
    expect(v.hp).toBe(MAX_HP);
  });

  it('пистолет: попадание тратит патрон и наносит урон, shot.hit=true', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'pistol';
    a.ammo = 5;
    v.z = -20; // в пределах 40, точно по центру конуса
    const shot = handleAttack(state, runtimes, 'a', 1000, []).shot;
    expect(a.ammo).toBe(4);
    expect(v.hp).toBe(MAX_HP - WEAPONS.pistol.damage);
    expect(shot).toEqual({ from: { x: 0, z: 0 }, to: { x: 0, z: -20 }, hit: true, victim: 'v' });
  });

  it('промах тратит патрон, shot.hit=false, to — точка на дальности', () => {
    const { state, a, runtimes } = setup();
    a.weapon = 'pistol';
    a.ammo = 5;
    state.players.delete('v'); // setup ставит жертву на линию огня — убираем, выстрел уходит в пустоту
    const shot = handleAttack(state, runtimes, 'a', 1000, []).shot;
    expect(a.ammo).toBe(4);
    expect(shot).toEqual({ from: { x: 0, z: 0 }, to: { x: 0, z: -40 }, hit: false, victim: '' });
  });

  it('пистолет не бьёт дальше своей дальности', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'pistol';
    a.ammo = 5;
    v.z = -41;
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP);
  });

  it('пистолет не бьёт вне узкого конуса (~12°)', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'pistol';
    a.ammo = 5;
    v.x = 7; v.z = -27; // dot ≈ 0.968 < 0.98
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP);
  });

  it('стена блокирует выстрел (LOS), tracer обрезается у стены', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'pistol';
    a.ammo = 5;
    v.z = -20;
    const wall = [{ x: 0, z: -10, w: 4, d: 2 }]; // ближняя грань z=-9
    const shot = handleAttack(state, runtimes, 'a', 1000, wall).shot;
    expect(v.hp).toBe(MAX_HP);
    expect(shot?.hit).toBe(false);
    expect(shot?.to.x).toBeCloseTo(0, 10);
    expect(shot?.to.z).toBeCloseTo(-9, 10); // не сквозь стену на -40
  });

  it('водитель машины — легальная цель (машина не укрытие)', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'pistol';
    a.ammo = 5;
    v.mode = 'car';
    v.z = -20;
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP - WEAPONS.pistol.damage);
  });

  it('убийство из пистолета: розыск и счётчики как у кулаков', () => {
    const { state, a, v, runtimes } = setup();
    a.weapon = 'pistol';
    a.ammo = 5;
    v.hp = WEAPONS.pistol.damage;
    const now = 5000;
    handleAttack(state, runtimes, 'a', now, []);
    expect(v.mode).toBe('dead');
    expect(a.wantedUntil).toBe(now + WANTED_DURATION_MS);
    expect(runtimes.get('a')!.kills).toBe(1);
  });

  it('смерть сжигает оружие и патроны', () => {
    const { state, v, runtimes } = setup();
    v.weapon = 'rifle';
    v.ammo = 120;
    v.hp = PUNCH_DAMAGE;
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.mode).toBe('dead');
    expect(v.weapon).toBe('');
    expect(v.ammo).toBe(0);
  });

  it('промах кулаком: swing=true, hits пуст', () => {
    const { state, runtimes } = setup();
    state.players.delete('v');
    const res = handleAttack(state, runtimes, 'a', 1000, []);
    expect(res.swing).toBe(true);
    expect(res.hits).toHaveLength(0);
    expect(res.attacker).toBe('a');
  });

  it('попадание: hits с уроном и координатами жертвы', () => {
    const { state, runtimes } = setup();
    const res = handleAttack(state, runtimes, 'a', 1000, []);
    expect(res.hits).toEqual([{ victim: 'v', damage: PUNCH_DAMAGE, x: 0, z: -1.5 }]);
  });

  it('жертва в безопасной зоне неуязвима (melee и ranged)', () => {
    const { state, a, v, runtimes } = setup();
    const zones = [{ x: 0, z: -1.5, w: 10, d: 10 }];
    let res = handleAttack(state, runtimes, 'a', 1000, [], zones);
    expect(v.hp).toBe(MAX_HP);
    expect(res.hits).toHaveLength(0);
    a.weapon = 'pistol'; a.ammo = 5; a.z = 10; // атакующий вне беззоны, жертва остаётся внутри
    res = handleAttack(state, runtimes, 'a', 3000, [], zones);
    expect(v.hp).toBe(MAX_HP);
    expect(res.shot?.hit).toBe(false);
  });

  it('атакующий в безопасной зоне не бьёт наружу', () => {
    const { state, runtimes } = setup();
    const zones = [{ x: 0, z: 0, w: 4, d: 4 }]; // атакующий внутри
    const res = handleAttack(state, runtimes, 'a', 1000, [], zones);
    expect(res.swing).toBe(false);
    expect(res.hits).toHaveLength(0);
  });

  it('зомби бьёт ZOMBIE_DAMAGE и не трогает других зомби', () => {
    const { state, a, v, runtimes } = setup();
    a.role = 'zombie';
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP - ZOMBIE_DAMAGE);
    v.role = 'zombie';
    const res = handleAttack(state, runtimes, 'a', 3000, []);
    expect(res.hits).toHaveLength(0);
  });

  it('убийство зомби: kills растёт, розыска нет', () => {
    const { state, a, v, runtimes } = setup();
    v.role = 'zombie';
    v.hp = PUNCH_DAMAGE;
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.mode).toBe('dead');
    expect(a.wantedUntil).toBe(0);
    expect(runtimes.get('a')!.kills).toBe(1);
  });

  it('зомби убивает игрока: розыск зомби не выставляется', () => {
    const { state, a, v, runtimes } = setup();
    a.role = 'zombie';
    v.hp = ZOMBIE_DAMAGE;
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.mode).toBe('dead');
    expect(a.wantedUntil).toBe(0);
  });

  it('при убийстве доля наличных выпадает пикапом cash на месте смерти', () => {
    const { state, v, runtimes } = setup();
    v.cash = 400;
    v.hp = PUNCH_DAMAGE;
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.cash).toBe(200);
    const drops = [...state.pickups.values()].filter(pk => pk.kind === 'cash');
    expect(drops).toHaveLength(1);
    expect(drops[0].amount).toBe(200);
    expect(drops[0].x).toBe(0);
    expect(drops[0].z).toBe(-1.5);
  });

  it('респаун всегда у больницы, даже с квартирой', () => {
    const { state, v, runtimes } = setup();
    v.hp = PUNCH_DAMAGE;
    v.apt = 'apt1'; // раньше респаунило у своей двери
    handleAttack(state, runtimes, 'a', 1000, []);
    const map = createCityMap();
    tickRespawn(state, runtimes, map, 1000 + RESPAWN_DELAY_MS + 1);
    expect(v.mode).toBe('foot');
    expect(v.x).toBe(map.hospitalDoor.x);
    expect(v.z).toBe(map.hospitalDoor.z);
  });

  it('зомби воскресает на zombieSpawns с ZOMBIE_HP после ZOMBIE_RESPAWN_MS', () => {
    const { state, v, runtimes } = setup();
    v.role = 'zombie';
    v.hp = PUNCH_DAMAGE;
    handleAttack(state, runtimes, 'a', 1000, []);
    const map = createCityMap();
    tickRespawn(state, runtimes, map, 1000 + RESPAWN_DELAY_MS + 1);
    expect(v.mode).toBe('dead'); // рано
    tickRespawn(state, runtimes, map, 1000 + ZOMBIE_RESPAWN_MS + 1);
    expect(v.mode).toBe('foot');
    expect(v.hp).toBe(ZOMBIE_HP);
    const onSpawn = map.zombieSpawns.some(s => s.x === v.x && s.z === v.z);
    expect(onSpawn).toBe(true);
  });
});

describe('дропы при смерти', () => {
  function setupKill() {
    const state = new GameState();
    const runtimes = new Map();
    const killer = new Player();
    killer.name = 'killer';
    state.players.set('k', killer);
    runtimes.set('k', makeRuntime(0));
    const victim = new Player();
    victim.name = 'victim';
    victim.hp = 10;
    state.players.set('v', victim);
    runtimes.set('v', makeRuntime(0));
    return { state, runtimes, killer, victim };
  }

  it('с игрока падает его оружие пикапом', () => {
    const { state, runtimes, victim } = setupKill();
    victim.weapon = 'rifle';
    victim.cash = 0;
    killPlayer(state, runtimes, 'k', 'v', 1000);
    const drops = [...state.pickups.values()].filter(pk => pk.kind === 'rifle');
    expect(drops).toHaveLength(1);
    expect(victim.weapon).toBe('');
  });

  it('с зомби падает 10-29$ (PvE-фарм), убийце-зомби — ничего', () => {
    const { state, runtimes, victim } = setupKill();
    victim.role = 'zombie';
    victim.cash = 0;
    killPlayer(state, runtimes, 'k', 'v', 1000);
    const drops = [...state.pickups.values()].filter(pk => pk.kind === 'cash');
    expect(drops).toHaveLength(1);
    expect(drops[0].amount).toBeGreaterThanOrEqual(10);
    expect(drops[0].amount).toBeLessThanOrEqual(29);
  });

  it('без оружия — без оружейного дропа', () => {
    const { state, runtimes, victim } = setupKill();
    victim.weapon = '';
    victim.cash = 0;
    killPlayer(state, runtimes, 'k', 'v', 1000);
    expect([...state.pickups.values()].filter(pk => pk.kind !== 'cash')).toHaveLength(0);
  });
});
