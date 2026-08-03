import { createCityMap, stepFoot, stepCar, type AABB, type CarStepState, type MoveInput } from '@mmo/shared';

// Предсказание своего движения: сервер авторитетен, но его state приходит
// с частотой патчей (~20 Гц) — рендерить своего по нему = ступеньки. Считаем
// локально каждый кадр той же stepFoot/stepCar (общая с сервером математика), а
// серверный state используем как коррекцию при расхождении (телепорты: респавн,
// тюрьма, развороты от беззон).
export class Prediction {
  x = 0;
  z = 0;
  car: CarStepState | null = null; // предсказанное состояние своей машины; null — не в машине
  private active = false;
  private colliders: AABB[];
  private safeZones: AABB[];

  constructor() {
    const map = createCityMap();
    this.colliders = map.buildings.map(b => ({ x: b.x, z: b.z, w: b.w, d: b.d }));
    this.safeZones = map.safeZones;
  }

  // реконнект: сброс — следующий update жёстко примет серверную позицию
  reset(): void {
    this.active = false;
    this.car = null;
  }

  /** Вызывать каждый кадр. Возвращает true, если предсказание активно (mode 'foot'/'car'). */
  update(
    dt: number, input: MoveInput, mode: string, serverX: number, serverZ: number,
    serverCar?: { x: number; z: number; rotY: number; speed: number },
  ): boolean {
    if (mode === 'car' && serverCar) {
      if (!this.car) this.car = { x: serverCar.x, z: serverCar.z, rotY: serverCar.rotY, speed: serverCar.speed };
      const pdt = Math.min(dt, 0.1); // спайк dt после сворачивания вкладки не даёт больших шагов
      stepCar(this.car, input, pdt, this.colliders, this.safeZones);
      const dx = serverCar.x - this.car.x;
      const dz = serverCar.z - this.car.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 9) {
        // >3 м — телепорт/сильный рассинхрон: жёстко принимаем серверную позицию
        this.car = { x: serverCar.x, z: serverCar.z, rotY: serverCar.rotY, speed: serverCar.speed };
      } else if (d2 > 0.25) {
        // 0.5–3 м — мягкий догон; меньше — обычный лаг патчей, не трогаем (иначе резинит)
        const k = Math.min(1, pdt * 5);
        this.car.x += dx * k;
        this.car.z += dz * k;
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
    const dx = serverX - this.x;
    const dz = serverZ - this.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 9) {
      // >3 м — телепорт/сильный рассинхрон: жёстко принимаем серверную позицию
      this.x = serverX;
      this.z = serverZ;
    } else if (d2 > 0.25) {
      // 0.5–3 м — мягкий догон; меньше — обычный лаг патчей, не трогаем (иначе резинит)
      const k = Math.min(1, pdt * 5);
      this.x += dx * k;
      this.z += dz * k;
    }
    return true;
  }
}
