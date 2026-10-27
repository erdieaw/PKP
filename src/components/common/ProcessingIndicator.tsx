import './processing-indicator.css';

interface ProcessingIndicatorProps {
  label: string;
  description: string;
}

export function ProcessingIndicator({ label, description }: ProcessingIndicatorProps) {
  return (
    <div className="processing-indicator" role="status" aria-live="polite" aria-atomic="true">
      <span className="processing-indicator__orbit" aria-hidden="true"><span /></span>
      <div className="processing-indicator__content">
        <div className="processing-indicator__heading">
          <p className="processing-indicator__label">{label}</p>
          <span className="processing-indicator__dots" aria-hidden="true"><span /><span /><span /></span>
        </div>
        <p className="processing-indicator__description">{description}</p>
        <div className="processing-indicator__track" aria-hidden="true"><span /></div>
      </div>
    </div>
  );
}
