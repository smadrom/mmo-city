import { describe, it, expect } from 'vitest';
import { collidesCircleAABB, moveCircle, clamp, dist2, segmentHitsAABB, segmentAABBEnterT, stepFoot, pointInAABB, inAnyAABB } from '../src/physics.js';
import { PLAYER_SPEED, PLAYER_SPRINT, PLAYER_RADIUS, MAP_HALF } from '../src/config.js';

const wall = { x: 10, z: 0, w: 2, d: 10 }; // стена x: 9..11, z: -5..5

describe('collidesCircleAABB', () => {
  it('обнаруживает пересечение', () => {
    expect(collidesCircleAABB(8.8, 0, 0.5, wall)).toBe(true);
  });
  it('не пересекается на расстоянии', () => {
    expect(collidesCircleAABB(8.0, 0, 0.5, wall)).toBe(false);
  });
});

describe('moveCircle', () => {
  it('двигает свободно без препятствий', () => {
    const r = moveCircle(0, 0, 1, 0, 0.5, []);
    expect(r).toEqual({ x: 1, z: 0 });
  });
  it('блокирует ось, упирающуюся в стену', () => {
    const r = moveCircle(8, 0, 1.5, 0, 0.5, [wall]);
    expect(r.x).toBe(8);
  });
  it('позволяет скольжение вдоль стены', () => {
    const r = moveCircle(8, 0, 1.5, 3, 0.5, [wall]);
    expect(r.x).toBe(8);
    expect(r.z).toBe(3);
  });
});

describe('clamp / dist2', () => {
  it('clamp ограничивает значение', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
  });
  it('dist2 считает квадрат расстояния', () => {
    expect(dist2(0, 0, 3, 4)).toBe(25);
  });
});

describe('segmentHitsAABB', () => {
  // wall = { x: 10, z: 0, w: 2, d: 10 } → x: 9..11, z: -5..5 (уже объявлен в файле)
  it('отрезок через стену пересекает её', () => {
    expect(segmentHitsAABB(0, 0, 20, 0, wall)).toBe(true);
  });
  it('касание грани считается пересечением', () => {
    expect(segmentHitsAABB(0, 0, 9, 0, wall)).toBe(true);
  });
  it('отрезок мимо стены не пересекает', () => {
    expect(segmentHitsAABB(0, 10, 20, 10, wall)).toBe(false);
  });
  it('отрезок, заканчивающийся перед стеной, не пересекает', () => {
    expect(segmentHitsAABB(0, 0, 8, 0, wall)).toBe(false);
  });
  it('отрезок внутри стены пересекает', () => {
    expect(segmentHitsAABB(9.5, 0, 10.5, 0, wall)).toBe(true);
  });
});

describe('segmentAABBEnterT', () => {
  // wall = { x: 10, z: 0, w: 2, d: 10 } → x: 9..11, z: -5..5
  it('возвращает t входа в стену', () => {
    expect(segmentAABBEnterT(0, 0, 20, 0, wall)).toBeCloseTo(0.45, 10); // x=9 при t=9/20
  });
  it('null при промахе', () => {
    expect(segmentAABBEnterT(0, 10, 20, 10, wall)).toBeNull();
  });
  it('0, если начало внутри стены', () => {
    expect(segmentAABBEnterT(9.5, 0, 30, 0, wall)).toBe(0);
  });
  it('при диагонали вход определяется более поздней гранью', () => {
    // отрезок (0,-10)→(20,0): x-грань при t=0.45, z-грань (z=-5) при t=0.5 → вход t=0.5 (точка (10,-5))
    expect(segmentAABBEnterT(0, -10, 20, 0, wall)).toBeCloseTo(0.5, 10);
  });
});

describe('pointInAABB / inAnyAABB', () => {
  const zone = { x: 0, z: 0, w: 10, d: 20 }; // x: -5..5, z: -10..10
  it('точка внутри и снаружи', () => {
    expect(pointInAABB(5, 10, zone)).toBe(true);
    expect(pointInAABB(5.1, 0, zone)).toBe(false);
    expect(inAnyAABB(0, 0, [zone])).toBe(true);
    expect(inAnyAABB(100, 0, [zone])).toBe(false);
  });
});

describe('stepFoot', () => {
  const noKeys = { up: false, down: false, left: false, right: false, sprint: false, rotY: 0 };
  const dt = 0.05; // тик 20 Гц

  it('без ввода стоит на месте', () => {
    expect(stepFoot(3, 4, noKeys, dt, [])).toEqual({ x: 3, z: 4 });
  });

  it('up при rotY=0 двигает в -z со скоростью PLAYER_SPEED', () => {
    const r = stepFoot(0, 0, { ...noKeys, up: true }, dt, []);
    expect(r.x).toBeCloseTo(0, 10);
    expect(r.z).toBeCloseTo(-PLAYER_SPEED * dt, 10);
  });

  it('sprint даёт PLAYER_SPRINT', () => {
    const r = stepFoot(0, 0, { ...noKeys, up: true, sprint: true }, dt, []);
    expect(r.z).toBeCloseTo(-PLAYER_SPRINT * dt, 10);
  });

  it('диагональ нормирована: не быстрее прямой', () => {
    const r = stepFoot(0, 0, { ...noKeys, up: true, right: true }, dt, []);
    expect(Math.hypot(r.x, r.z)).toBeCloseTo(PLAYER_SPEED * dt, 10);
  });

  it('стена блокирует движение', () => {
    // wall x: 9..11, z: -5..5; бежим в +x (right при rotY=0).
    // Шаг 0.25 м: с x=8.4 целевая 8.65 уже в радиусе 0.5 от грани x=9 → блок.
    const r = stepFoot(8.4, 0, { ...noKeys, right: true }, dt, [wall]);
    expect(r.x).toBe(8.4); // x не сдвинулся — упёрся
  });

  it('клэмпит у границы мира', () => {
    const r = stepFoot(-MAP_HALF + PLAYER_RADIUS - 0.01, 0, { ...noKeys, left: true }, dt, []);
    expect(r.x).toBeGreaterThanOrEqual(-MAP_HALF + PLAYER_RADIUS);
  });

  it('кастомная скорость шага (зомби медленнее игрока)', () => {
    const r = stepFoot(0, 0, { ...noKeys, up: true }, dt, [], 4.5);
    expect(r.z).toBeCloseTo(-4.5 * dt, 10);
  });
});
