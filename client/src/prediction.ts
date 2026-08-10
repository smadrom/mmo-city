import { createCityMap, stepFoot, stepCar, type AABB, type CarStepState, type MoveInput } from '@mmo/shared';

// Предсказание своего движения: сервер авторитетен, но его state приходит
// с частотой патчей (~20 Гц) — рендерить своего по нему = ступеньки. Считаем
// локально каждый кадр той же stepFoot/stepCar (общая с сервером математика).
// Реконсиляция: серверный снап позиции устарел на ~RTT/2+полпатча, поэтому
// сравниваем предсказание не с сырым снапом, а с его ЭКСТРАПОЛЯЦИЕЙ на «сейчас»
// (иначе на пинге 200+ мс догон тянет назад на метры — «ватность» и рывки).
// Жёсткий snap — только настоящие телепорты (>5 м: респавн, тюрьма).
const SNAP_D2 = 25; // >5 м — телепорт
const BLEND_RATE = 8; // сила мягкого догона (x/z, rotY, speed)
const MAX_LAG_S = 0.3; // кап экстраполяции на патологических лагах

function lerpAngleDelta(from: number, to: number, k: number): number {
  const d = ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return from + d * k;
}

export class Prediction {
  x = 0;
  z = 0;
  car: CarStepState | null = null; // предсказанное состояние своей машины; null — не в машине
  private active = false;
  private colliders: AABB[];
  private safeZones: AABB[];
  private lagSec = 0.135; // оценка устаревания серверного снапа (RTT/2 + полпатча), из setRtt
  private srvVelX = 0; // скорость серверной позиции (пешком), из дельт между патчами
  private srvVelZ = 0;
  private prevSrvX = 0;
  private prevSrvZ = 0;
  private prevPatchAt = 0; // serverTime последнего принятого патча

  constructor() {
    const map = createCityMap();
    this.colliders = map.buildings.map(b => ({ x: b.x, z: b.z, w: b.w, d: b.d }));
    this.safeZones = map.safeZones;
  }

  // измеренный RTT (ping/pong в main) → оценка лага серверных снапов
  setRtt(rttMs: number): void {
    this.lagSec = Math.min(MAX_LAG_S, Math.max(0.03, rttMs / 2000) + 0.025);
  }

  // реконнект: сброс — следующий update жёстко примет серверную позицию
  reset(): void {
    this.active = false;
    this.car = null;
    this.srvVelX = 0;
    this.srvVelZ = 0;
    this.prevPatchAt = 0;
  }

  /** Вызывать каждый кадр. Возвращает true, если предсказание активно (mode 'foot'/'car'). */
  update(
    dt: number, input: MoveInput, mode: string, serverX: number, serverZ: number,
    serverCar?: { x: number; z: number; rotY: number; speed: number },
    serverTimeMs = 0, rttMs = 0,
  ): boolean {
    if (rttMs > 0) this.setRtt(rttMs);
    // новый патч → пересчёт скорости серверной позиции (пешком в state скорости нет)
    if (serverTimeMs > 0 && serverTimeMs !== this.prevPatchAt) {
      const dtp = (serverTimeMs - this.prevPatchAt) / 1000;
      if (this.prevPatchAt > 0 && dtp > 0.005 && dtp < 0.5) {
        this.srvVelX = (serverX - this.prevSrvX) / dtp;
        this.srvVelZ = (serverZ - this.prevSrvZ) / dtp;
      }
      this.prevPatchAt = serverTimeMs;
      this.prevSrvX = serverX;
      this.prevSrvZ = serverZ;
    }
    if (mode === 'car' && serverCar) {
      if (!this.car) this.car = { x: serverCar.x, z: serverCar.z, rotY: serverCar.rotY, speed: serverCar.speed };
      const pdt = Math.min(dt, 0.1); // спайк dt после сворачивания вкладки не даёт больших шагов
      stepCar(this.car, input, pdt, this.colliders, this.safeZones);
      // экстраполяция: куда серверная машина доехала к «сейчас» (скорость/курс в state)
      const tx = serverCar.x - Math.sin(serverCar.rotY) * serverCar.speed * this.lagSec;
      const tz = serverCar.z - Math.cos(serverCar.rotY) * serverCar.speed * this.lagSec;
      const dx = tx - this.car.x;
      const dz = tz - this.car.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > SNAP_D2) {
        // телепорт (респавн/тюрьма/выброс из машины) — жёстко принимаем сервер
        this.car = { x: serverCar.x, z: serverCar.z, rotY: serverCar.rotY, speed: serverCar.speed };
      } else {
        // догон без рывков: позиция, курс и скорость плавно тянем к серверным
        const k = Math.min(1, pdt * BLEND_RATE);
        this.car.x += dx * k;
        this.car.z += dz * k;
        this.car.rotY = lerpAngleDelta(this.car.rotY, serverCar.rotY, k);
        this.car.speed += (serverCar.speed - this.car.speed) * k;
      }
      this.x = this.car.x;
      this.z = this.car.z;
      return true;
    }
    this.car = null;
    if (mode !== 'foot') {
      this.active = false; // смерть/тюрьма — едем строго по серверу
      return false;
    }
    if (!this.active) {
      this.x = serverX;
      this.z = serverZ;
      this.active = true;
      return true;
    }
    const pdt = Math.min(dt, 0.1);
    const res = stepFoot(this.x, this.z, input, pdt, this.colliders);
    this.x = res.x;
    this.z = res.z;
    // экстраполяция серверной позиции на лаг (см. srvVel)
    const tx = serverX + this.srvVelX * this.lagSec;
    const tz = serverZ + this.srvVelZ * this.lagSec;
    const dx = tx - this.x;
    const dz = tz - this.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > SNAP_D2) {
      // телепорт (респавн/тюрьма) — жёстко принимаем сервер
      this.x = serverX;
      this.z = serverZ;
    } else if (d2 > 0.25) {
      // догон без рывков; меньше 0.5 м — обычный лаг патчей, не трогаем
      const k = Math.min(1, pdt * BLEND_RATE);
      this.x += dx * k;
      this.z += dz * k;
    }
    return true;
  }
}
