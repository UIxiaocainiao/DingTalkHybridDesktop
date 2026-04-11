import React, { useRef, useEffect, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText as GSAPSplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(ScrollTrigger, GSAPSplitText, useGSAP);

const SplitText = ({
  text,
  className = '',
  delay = 50,
  duration = 1.25,
  ease = 'power3.out',
  splitType = 'chars',
  from = { opacity: 0, y: 40 },
  to = { opacity: 1, y: 0 },
  threshold = 0.1,
  rootMargin = '-100px',
  tag = 'p',
  textAlign = 'center',
  onLetterAnimationComplete
}) => {
  const ref = useRef(null);
  const animationCompletedRef = useRef(false);
  const onCompleteRef = useRef(onLetterAnimationComplete);
  const [fontsLoaded, setFontsLoaded] = useState(false);

  // Ensure numeric values in animation props to prevent SVG transform errors
  const sanitizeAnimationProps = (props) => {
    const sanitized = {};
    Object.keys(props).forEach(key => {
      const value = props[key];
      if (typeof value === 'number') {
        sanitized[key] = value;
      } else if (typeof value === 'string') {
        const parsed = parseFloat(value);
        sanitized[key] = isNaN(parsed) ? value : parsed;
      } else {
        sanitized[key] = value;
      }
    });
    return sanitized;
  };

  const safeFrom = sanitizeAnimationProps(from);
  const safeTo = sanitizeAnimationProps(to);

  // Keep callback ref updated
  useEffect(() => {
    onCompleteRef.current = onLetterAnimationComplete;
  }, [onLetterAnimationComplete]);

  useEffect(() => {
    if (document.fonts.status === 'loaded') {
      setFontsLoaded(true);
    } else {
      document.fonts.ready.then(() => {
        setFontsLoaded(true);
      });
    }
  }, []);

  useGSAP(() => {
    if (!ref.current || !text || !fontsLoaded) return;
    // Prevent re-animation if already completed
    if (animationCompletedRef.current) return;
    const el = ref.current;

    if (el._rbsplitInstance) {
      try {
        el._rbsplitInstance.revert();
      } catch (_) {}
      el._rbsplitInstance = undefined;
    }

    const startPct = (1 - threshold) * 100;
    const marginMatch = /^(-?\d+(?:\.\d+)?)(px|em|rem|%)?$/.exec(rootMargin);
    const marginValue = marginMatch ? parseFloat(marginMatch[1]) : 0;
    const marginUnit = marginMatch ? marginMatch[2] || 'px' : 'px';
    const sign =
      marginValue === 0
        ? ''
        : marginValue < 0
          ? `-=${Math.abs(marginValue)}${marginUnit}`
          : `+=${marginValue}${marginUnit}`;
    const start = `top ${startPct}%${sign}`;
    let targets = [];
    const assignTargets = (self) => {
      if (splitType.includes('chars') && (self).chars?.length)
        targets = (self).chars;
      if (!targets.length && splitType.includes('words') && self.words.length) targets = self.words;
      if (!targets.length && splitType.includes('lines') && self.lines.length) targets = self.lines;
      if (!targets.length) targets = self.chars || self.words || self.lines;
    };
    const splitInstance = new GSAPSplitText(el, {
      type: splitType,
      smartWrap: true,
      autoSplit: splitType === 'lines',
      linesClass: 'split-line',
      wordsClass: 'split-word',
      charsClass: 'split-char',
      reduceWhiteSpace: false,
      onSplit: (self) => {
        assignTargets(self);
        return gsap.fromTo(targets, { ...safeFrom }, {
          ...safeTo,
          duration,
          ease,
          stagger: delay / 1000,
          scrollTrigger: {
            trigger: el,
            start,
            once: true,
            fastScrollEnd: true,
            anticipatePin: 0.4
          },
          onComplete: () => {
            animationCompletedRef.current = true;
            onCompleteRef.current?.();
          },
          willChange: 'transform, opacity',
          force3D: true
        });
      }
    });
    el._rbsplitInstance = splitInstance;
    return () => {
      ScrollTrigger.getAll().forEach(st => {
        if (st.trigger === el) st.kill();
      });
      try {
        splitInstance.revert();
      } catch (_) {}
      el._rbsplitInstance = undefined;
    };
  }, {
    dependencies: [
      text,
      delay,
      duration,
      ease,
      splitType,
      JSON.stringify(safeFrom),
      JSON.stringify(safeTo),
      threshold,
      rootMargin,
      fontsLoaded
    ],
    scope: ref
  });

  const renderTag = () => {
    const style = {
      textAlign,
      wordWrap: 'break-word',
      willChange: 'transform, opacity'
    };
    const classes = `split-parent overflow-hidden inline-block whitespace-normal ${className}`;
    const Tag = (tag || 'p');

    return (
      <Tag ref={ref} style={style} className={classes}>
        {text}
      </Tag>
    );
  };

  return renderTag();
};

export default SplitText;
