import { useEffect, useState } from 'react';

export default function DevConsoleGate() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeydown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [isOpen]);

  return (
    <div
      className={`api-key-gate ui-modal-gate ${isOpen ? 'is-open' : ''}`}
      id="dev-console-gate"
      aria-hidden={!isOpen}
      style={{
        background: 'rgba(0, 0, 0, 0.9)',
        padding: '20px',
        display: isOpen ? 'block' : 'none',
      }}
    >
      <textarea
        id="dev-console-output"
        readOnly
        style={{
          width: '100%',
          height: '100%',
          background: 'transparent',
          color: '#00ff00',
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: '13px',
          border: 'none',
          outline: 'none',
          resize: 'none',
          overflowY: 'auto',
        }}
        placeholder="Developer Console Initialized. Press Escape to close."
      ></textarea>
    </div>
  );
}
