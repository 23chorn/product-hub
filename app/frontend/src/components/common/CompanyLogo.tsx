import { AsciiMark } from './AsciiMark';

/** Compact rendering of the company's ASCII-art mark, sized to sit inline next to the app title. */
export function CompanyLogo({ className = '' }: { className?: string }) {
  return <AsciiMark width={43} className={className} colored />;
}
