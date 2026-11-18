import { useState, useCallback, useEffect, useMemo, useRef } from 'react';

export type ModalId =
  | 'import'
  | 'production'
  | 'summary'
  | 'profile'
  | 'preBattle'
  | 'siege'
  | 'reinforcement'
  | 'devStudio'
  | 'auth'
  | 'baseProduction'
  | 'infraBuilder'
  | 'droneScheduler';

/**
 * Hook para gestionar una pila de modales con soporte de z-index dinámico y cierre por tecla Escape.
 */
export function useModalStack(
  onPopCleanup?: (key: ModalId) => void,
  onEscapeCancel?: () => void
) {
  const [stack, setStack] = useState<ModalId[]>([]);
  const onEscapeCancelRef = useRef(onEscapeCancel);
  onEscapeCancelRef.current = onEscapeCancel;

  const pushModal = useCallback((key: ModalId) => {
    setStack((prev) =>
      prev[prev.length - 1] === key ? prev : [...prev.filter((k) => k !== key), key]
    );
  }, []);

  const removeModal = useCallback((key: ModalId) => {
    setStack((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : prev));
  }, []);

  const popModal = useCallback(() => {
    setStack((prev) => {
      if (prev.length === 0) return prev;
      const top = prev[prev.length - 1];
      onPopCleanup?.(top);
      return prev.slice(0, -1);
    });
  }, [onPopCleanup]);

  const isOpen = useCallback((key: ModalId) => stack.includes(key), [stack]);

  const getZIndex = useCallback(
    (key: ModalId) => {
      const idx = stack.indexOf(key);
      return idx >= 0 ? 50 + idx : 50;
    },
    [stack]
  );

  useEffect(() => {
    if (stack.length === 0) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscapeCancelRef.current?.();
        popModal();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [stack.length, popModal]);

  return useMemo(
    () => ({
      stack,
      hasOpenModals: stack.length > 0,
      topModal: stack.length > 0 ? stack[stack.length - 1] : null,
      pushModal,
      popModal,
      removeModal,
      isOpen,
      getZIndex,
    }),
    [stack, pushModal, popModal, removeModal, isOpen, getZIndex]
  );
}
