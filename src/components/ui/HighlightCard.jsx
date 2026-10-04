/** @param {{ label: import('react').ReactNode, value: import('react').ReactNode, subvalue?: import('react').ReactNode, accent: string }} props */
function HighlightCard({ label, value, subvalue, accent }) {
  return (
    <div className={`highlight-card ${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {subvalue ? <small>{subvalue}</small> : null}
    </div>
  );
}

export default HighlightCard;
