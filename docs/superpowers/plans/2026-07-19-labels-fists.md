# Этап «Подписи и кулаки» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подписать здания и точки интереса парящими спрайтами и добавить игрокам статичные кулаки-шарики по бокам.

**Architecture:** Только клиент, два файла: `client/src/world.ts` (спрайты-подписи через canvas → THREE.Sprite, как ники в avatars.ts) и `client/src/avatars.ts` (два шарика в группе игрока, видимость пешком без оружия). Сервер, shared и схема не трогаем.

**Tech Stack:** TypeScript, Three.js, Vite.

## Global Constraints

- Спека: `docs/superpowers/specs/2026-07-19-labels-fists-design.md`.
- Клиентских автотестов в проекте нет — верификация по спеке р.5: `npm run build -w client` (tsc + vite) зелёный + ручная проверка на localhost.
- Кулаки видны только `onFoot && !p.weapon` (`onFoot = p.mode !== 'car'`); при смерти группа уже скрыта существующим кодом.
- Подписи зданий по kind: hospital → `Больница`, police → `Полиция`, warehouse → `Склад`, house → `Жилой дом`; точки: `Оружейный магазин`, deliveryTargets shop/gas/port → `Магазин`/`Заправка`/`Порт`.
- Локальный dev-сервер уже запущен в фоне (`npm run dev`, клиент :5173, сервер :2567) — Vite подхватит правки сам.

---

### Task 1: Подписи зданий и точек (world.ts)

**Files:**
- Modify: `client/src/world.ts`

**Interfaces:**
- Consumes: `map.buildings` (`BuildingDef.kind`), `map.gunShop`, `map.deliveryTargets` (`{ id, x, z }`) из `createCityMap()` (`shared/src/map.ts`) — уже доступны в `buildWorld`.
- Produces: ничего наружу; визуальный эффект в сцене.

- [ ] **Step 1: Добавить хелпер makeTextSprite в `client/src/world.ts`**

Вставить после импортов, перед `buildWorld`:

```ts
function makeTextSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 14, 512, 100);
  ctx.font = 'bold 56px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 256, 64, 480);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
  sprite.scale.set(10, 2.5, 1);
  return sprite;
}
```

- [ ] **Step 2: Подписи зданий — дополнить цикл по `map.buildings`**

В `buildWorld`, внутри существующего цикла `for (const b of map.buildings)` после `scene.add(mesh)` добавить:

```ts
    const label = makeTextSprite(KIND_LABELS[b.kind]);
    label.position.set(b.x, b.h + 3, b.z);
    scene.add(label);
```

И перед `buildWorld` (рядом с `makeTextSprite`) добавить словарь:

```ts
const KIND_LABELS: Record<BuildingDef['kind'], string> = {
  hospital: 'Больница',
  police: 'Полиция',
  warehouse: 'Склад',
  house: 'Жилой дом',
};
```

Импорт в начале файла дополнить типом: `import { createCityMap, ROADS, ROAD_WIDTH, MAP_HALF, type CityMap, type Point, type BuildingDef } from '@mmo/shared';`

- [ ] **Step 3: Подписи точек интереса — в конце `buildWorld` перед `return map;`**

```ts
  const poi = (p: Point, text: string) => {
    const label = makeTextSprite(text);
    label.position.set(p.x, 6, p.z);
    scene.add(label);
  };
  poi(map.gunShop, 'Оружейный магазин');
  const TARGET_LABELS: Record<string, string> = { shop: 'Магазин', gas: 'Заправка', port: 'Порт' };
  for (const t of map.deliveryTargets) poi(t, TARGET_LABELS[t.id] ?? t.id);
```

- [ ] **Step 4: Сборка**

Run: `npm run build -w client`
Expected: `tsc --noEmit && vite build` завершается без ошибок (exit 0), в выводе `✓ built`.

- [ ] **Step 5: Ручная проверка**

Открыть http://localhost:5173, войти. Ожидания:
- над каждым зданием висит подпись (`Больница`, `Полиция`, `Склад`, `Жилой дом`);
- над оружейным магазином (фиолетовый круг) — `Оружейный магазин`;
- над бирюзовыми кругами доставки — `Магазин`, `Заправка`, `Порт`;
- подписи читаются с расстояния, повёрнуты к камере.

- [ ] **Step 6: Commit**

```bash
git add client/src/world.ts
git commit -m "feat(client): подписи зданий и точек интереса спрайтами"
```

---

### Task 2: Кулаки (avatars.ts)

**Files:**
- Modify: `client/src/avatars.ts`

**Interfaces:**
- Consumes: существующие `PlayerMesh`, `makePlayerMesh`, `update()`; поле `p.weapon` из схемы (уже используется для `mesh.gun.visible`).
- Produces: `PlayerMesh` += `fistL: THREE.Mesh; fistR: THREE.Mesh` (используется только внутри этого файла).

- [ ] **Step 1: Расширить интерфейс PlayerMesh**

В `client/src/avatars.ts` интерфейс `PlayerMesh` (строки 5-11) дополнить:

```ts
interface PlayerMesh {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  marker: THREE.Mesh;
  gun: THREE.Mesh;
  fistL: THREE.Mesh;
  fistR: THREE.Mesh;
}
```

- [ ] **Step 2: Создать кулаки в makePlayerMesh**

В `makePlayerMesh` перед `return { group, body, head, marker, gun };` добавить:

```ts
  const fistGeo = new THREE.SphereGeometry(0.18, 8, 6);
  const fistMat = new THREE.MeshLambertMaterial({ color: 0xffcc99 });
  const fistL = new THREE.Mesh(fistGeo, fistMat);
  fistL.position.set(-0.55, 1.2, -0.15);
  group.add(fistL);
  const fistR = new THREE.Mesh(fistGeo, fistMat);
  fistR.position.set(0.55, 1.2, -0.15);
  group.add(fistR);
```

И строку return заменить на:

```ts
  return { group, body, head, marker, gun, fistL, fistR };
```

- [ ] **Step 3: Видимость в update()**

В `Avatars.update()`, сразу после строк `mesh.body.visible = onFoot; mesh.head.visible = onFoot;` добавить:

```ts
      // кулаки — только пешим и с пустыми руками
      const handsFree = onFoot && !p.weapon;
      mesh.fistL.visible = handsFree;
      mesh.fistR.visible = handsFree;
```

- [ ] **Step 4: Сборка**

Run: `npm run build -w client`
Expected: без ошибок, `✓ built`.

- [ ] **Step 5: Ручная проверка**

Обновить http://localhost:5173, войти. Ожидания:
- у персонажа два шарика по бокам на уровне пояса;
- сесть в машину (E у машины) — кулаки прячутся, табличка остаётся;
- купить биту в оружейном магазине — кулаки прячутся; выбросить/конфисковать нельзя, поэтому для проверки достаточно покупки.

- [ ] **Step 6: Commit**

```bash
git add client/src/avatars.ts
git commit -m "feat(client): кулаки-шарики по бокам персонажа (пешком, без оружия)"
```

---

## Финал

- [ ] Прогнать `npm test` из корня — 92 теста должны остаться зелёными (сервер/shared не тронуты, проверка на всякий случай).
- [ ] Отчитаться пользователю; локальный dev-сервер оставить запущенным для игры.
