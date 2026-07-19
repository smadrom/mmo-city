import { createCityMap, stepFoot, type AABB, type MoveInput } from '@mmo/shared';

// Предсказание своего пешего движения: сервер авторитетен, но его state приходит
// с частотой патчей (~20 Гц) — рендерить своего по нему = ступеньки. Считаем
// локально каждый кадр той же stepFoot (общая с сервером математика), а серверный
// state используем как коррекцию при расхождении (телепорты: респавн, тюрьма).
export class Prediction {
  x = 0;
  z = 0;
  private active = false;
  private colliders: AABB[];

  constructor() {
    this.colliders = createCityMap().buildings.map(b => ({ x: b.x, z: b.z, w: b.w, d: b.d }));
  }

  /** Вызывать каждый кадр. Возвращает true, если предсказание активно (mode === 'foot'). */
  update(dt: number, input: MoveInput, mode: string, serverX: number, serverZ: number): boolean {
    if (mode !== 'foot') {
      this.active = false; // машина/смерть/тюрьма — едем строго по серверу
      return false;
    }
    if (!this.active) {
      this.x = serverX;
      this.z = serverZ;
      this.active = true;
      return true;
    }
    const pdt = Math.min(dt, 0.1); // спайк dt после сворачивания вкладки не даёт больших шагов
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
