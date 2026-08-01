import * as THREE from 'three';
import { setLang, applyStatic, t } from './i18n/index.js';
import type { Effects } from './effects.js';
import type { InputController } from './input.js';

// Меню настроек (Esc): громкость/мьют, язык, качество (тени + pixelRatio).
// Открывается центральным Esc-диспетчером в main (когда остальные оверлеи закрыты).
export class Settings {
  isOpen = false;
  private root = document.getElementById('settings')!;

  constructor(
    private effects: Effects,
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private input: InputController,
    private toast: (s: string) => void,
  ) {
    const vol = document.getElementById('setVolume') as HTMLInputElement;
    vol.value = String(Math.round(effects.volume * 100));
    vol.addEventListener('input', () => effects.setVolume(Number(vol.value) / 100));
    vol.addEventListener('change', () => vol.blur()); // иначе фокус глушит Esc (isTypingTarget ловит INPUT)
    const mute = document.getElementById('setMute') as HTMLInputElement;
    mute.checked = effects.muted;
    mute.addEventListener('change', () => { if (effects.muted !== mute.checked) effects.toggleMute(); });
    mute.addEventListener('change', () => mute.blur());
    document.getElementById('setRu')!.addEventListener('click', () => this.setLanguage('ru'));
    document.getElementById('setEn')!.addEventListener('click', () => this.setLanguage('en'));
    const quality = document.getElementById('setQuality') as HTMLSelectElement;
    quality.value = localStorage.getItem('quality') ?? 'high';
    this.applyQuality(quality.value);
    quality.addEventListener('change', () => {
      localStorage.setItem('quality', quality.value);
      this.applyQuality(quality.value);
    });
    document.getElementById('settingsClose')!.addEventListener('click', () => this.close());
  }

  private setLanguage(l: 'ru' | 'en'): void {
    setLang(l);
    applyStatic();
    this.toast(t('settings.langNote')); // 3D-подписи запечены при построении мира
  }

  // низкое качество = pixelRatio 1 + без теней (перекомпиляция материалов обязательна)
  private applyQuality(q: string): void {
    const high = q !== 'low';
    this.renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio, 2) : 1);
    this.renderer.shadowMap.enabled = high;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach(mm => (mm.needsUpdate = true)); // у домов material — массив из 6 (окна)
      else if (m) m.needsUpdate = true;
    });
  }

  open(): void {
    this.isOpen = true;
    (document.getElementById('setMute') as HTMLInputElement).checked = this.effects.muted; // мьют мог переключиться по N — синхронизируем чекбокс
    document.exitPointerLock();
    this.input.setBlocked(true);
    this.root.classList.remove('hidden');
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.input.setBlocked(false);
    this.root.classList.add('hidden');
  }
}
