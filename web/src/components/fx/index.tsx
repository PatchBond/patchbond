// Small motion primitives used across the app.

import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef, useState, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A number that springs to its new value (prices, counters). */
export function AnimatedNumber({ value, format = (n) => n.toFixed(0), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, format);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { type: "spring", stiffness: 140, damping: 22 });
    return () => c.stop();
  }, [value, mv, reduce]);
  return <motion.span className={cn("num", className)}>{text}</motion.span>;
}

/** Counts up from 0 the first time it scrolls into view. */
export function CountUp({ value, format, className }: { value: number; format?: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, margin: "-40px" });
  return (
    <span ref={ref}>
      <AnimatedNumber value={seen ? value : 0} format={format} className={className} />
    </span>
  );
}

const GLYPHS = "0123456789abcdef";

/** Text that "decrypts" into place — for hashes and signatures while they're being checked. */
export function Scramble({ text, active, className }: { text: string; active: boolean; className?: string }) {
  const [shown, setShown] = useState(text);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!active || reduce) {
      setShown(text);
      return;
    }
    let frame = 0;
    const total = 22;
    const id = setInterval(() => {
      frame++;
      const fixed = Math.floor((frame / total) * text.length);
      setShown(
        text
          .split("")
          .map((ch, i) => (i < fixed || ch === ":" || ch === "x" ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]))
          .join(""),
      );
      if (frame >= total) {
        clearInterval(id);
        setShown(text);
      }
    }, 28);
    return () => clearInterval(id);
  }, [text, active, reduce]);
  return <span className={className}>{shown}</span>;
}

/** A card whose border glows where the cursor is. */
export function Spotlight({ children, className, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--x", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--y", `${e.clientY - r.top}px`);
  };
  return (
    <div onMouseMove={onMove} className={cn("spotlight rounded-2xl", className)} {...rest}>
      {children}
    </div>
  );
}

/**
 * Fades and lifts children in as they scroll into view. Falls back to showing after a moment, so
 * content is never stuck invisible where IntersectionObserver doesn't fire (headless screenshots).
 */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [forced, setForced] = useState(false);
  useEffect(() => {
    // Automated browsers show everything at once; everyone else gets the scroll reveal, with a safety net.
    const t = setTimeout(() => setForced(true), (navigator.webdriver ? 100 : 6000) + delay * 1000);
    return () => clearTimeout(t);
  }, [delay]);
  const show = inView || forced;
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 18 }}
      animate={show ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
      transition={{ duration: 0.6, delay: inView ? delay : 0, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

export const usd = (n: number) => `$${(n / 1e6).toFixed(2)}`;
