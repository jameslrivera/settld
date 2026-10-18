export function RibbonS({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-label="Settld" role="img">
      <path d="M0 10 L44 10 L56 26 L12 26 Z" fill="var(--brand)" />
      <path d="M12 26 L56 26 L44 42 L0 42 Z" fill="var(--brand-2)" />
      <path d="M0 42 L44 42 L56 58 L12 58 Z" fill="var(--brand)" transform="translate(0,-4)" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`font-semibold tracking-[-0.04em] ${className}`}>Settld<span className="text-[#ff2fb6]">.</span></span>;
}
