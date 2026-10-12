import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Volume2, VolumeX } from 'lucide-react';

const preferenceKey = 'ligahub:ui-sound';
const Experience = createContext({ enabled: false, toggle: () => {} });

export function ExperienceProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(preferenceKey) === 'on';
    } catch {
      return false;
    }
  });
  const audio = useRef<AudioContext | null>(null);
  const soundEnabled = useRef(enabled);
  const lastTone = useRef(0);
  const play = useCallback(() => {
    try {
      if (!window.AudioContext || performance.now() - lastTone.current < 90)
        return;
      lastTone.current = performance.now();
      audio.current ??= new AudioContext();
      const context = audio.current;
      const tone = () => {
        if (!soundEnabled.current || context.state !== 'running') return;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(660, start);
        oscillator.frequency.exponentialRampToValueAtTime(440, start + 0.08);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.025, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.09);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(start);
        oscillator.stop(start + 0.1);
      };
      if (context.state === 'suspended')
        void context
          .resume()
          .then(tone)
          .catch(() => {});
      else tone();
    } catch {
      /* Audio availability must never block an interaction. */
    }
  }, []);
  useEffect(
    () => () => {
      void audio.current?.close().catch(() => {});
    },
    [],
  );
  const toggle = () => {
    const next = !enabled;
    soundEnabled.current = next;
    setEnabled(next);
    try {
      localStorage.setItem(preferenceKey, next ? 'on' : 'off');
    } catch {
      /* Optional preference. */
    }
    if (next) play();
  };
  return (
    <Experience.Provider value={{ enabled, toggle }}>
      <div
        onClickCapture={(event) => {
          if (!enabled || !(event.target instanceof Element)) return;
          const control = event.target.closest('a[href],button');
          if (
            control &&
            !control.hasAttribute('disabled') &&
            control.getAttribute('aria-disabled') !== 'true' &&
            control.getAttribute('data-ui-sound') !== 'off'
          )
            play();
        }}
      >
        {children}
      </div>
    </Experience.Provider>
  );
}

export function SoundToggle() {
  const { enabled, toggle } = useContext(Experience);
  return (
    <button
      type="button"
      className="sound-toggle"
      aria-label="Sons da interface"
      aria-pressed={enabled}
      title={enabled ? 'Silenciar sons' : 'Ativar sons'}
      data-ui-sound="off"
      onClick={toggle}
    >
      {enabled ? (
        <Volume2 size={17} aria-hidden="true" />
      ) : (
        <VolumeX size={17} aria-hidden="true" />
      )}
      <span className="hidden sm:inline">Sons</span>
    </button>
  );
}

export function MotionSection({
  children,
  change,
  className = '',
}: {
  children: ReactNode;
  change: string | number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      !ref.current?.animate ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const animation = ref.current.animate(
      [
        { opacity: 0.5, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 220, easing: 'cubic-bezier(.2,.7,.2,1)' },
    );
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => {
      if (preference.matches) animation.cancel();
    };
    preference.addEventListener('change', stop);
    return () => {
      animation.cancel();
      preference.removeEventListener('change', stop);
    };
  }, [change]);
  return (
    <div ref={ref} className={`motion-stage ${className}`}>
      {children}
    </div>
  );
}
