interface BlackoutProps {
  color: '#000' | '#fff' | null;
}

export function Blackout({ color }: BlackoutProps) {
  if (!color) {
    return null;
  }

  return (
    <div
      className={`blackout-overlay ${color === '#000' ? 'black' : 'white'}`}
      data-testid="blackout-overlay"
    />
  );
}
