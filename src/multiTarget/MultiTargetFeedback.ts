export type MultiTargetFeedbackSeverity = 'info' | 'warning' | 'error';
export type MultiTargetFeedbackChannel = 'primary' | 'secondary';

function targetCount(count: number, qualifier: string): string {
  return `${count} ${qualifier} target${count === 1 ? '' : 's'}`;
}

function nounCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatMultiTargetOperationStatus(action: 'Running on' | 'Searching', connected: number): string {
  return `${action} ${targetCount(connected, 'connected')}...`;
}

export function formatMultiTargetSkippedStatus(skipped: number): string {
  return `${targetCount(skipped, 'disconnected')} skipped.`;
}

export function formatMultiTargetUnavailableStatus(skipped: number, title: string): string {
  return `${targetCount(skipped, 'unavailable')} skipped while loading "${title}".`;
}

export function formatMultiTargetConnectionFailureStatus(failed: number): string {
  return `${nounCount(failed, 'target')} failed to connect.`;
}

export function formatMultiTargetSearchCompletedStatus(searched: number, results: number, failed = 0, stopped = 0): string {
  const parts = [
    'Search completed',
    `${nounCount(searched, 'target')} searched`,
    `${nounCount(results, 'result')} found`
  ];
  if (failed > 0) parts.push(`${failed} failed`);
  if (stopped > 0) parts.push(`${stopped} stopped`);
  return `${parts.join(' · ')}.`;
}

export function formatMultiTargetCommandsCompletedStatus(finished: number, failed = 0, stopped = 0): string {
  const parts = ['Commands completed', `${nounCount(finished, 'target')} finished`];
  if (failed > 0) parts.push(`${failed} failed`);
  if (stopped > 0) parts.push(`${stopped} stopped`);
  return `${parts.join(' · ')}.`;
}

export function renderMultiTargetFeedbackScript(): string {
  return String.raw`  let feedbackPrimaryPersistent = false;
  let feedbackSecondaryPersistent = false;
  let feedbackSecondaryPriority = 0;
  let feedbackSecondaryScope = '';
  function feedbackPriority(severity) {
    return severity === 'error' ? 3 : severity === 'warning' ? 2 : 1;
  }
  function setFeedbackLine(channel, text, persistent, scope, tooltip) {
    const element = $(channel === 'primary' ? 'feedback-primary' : 'feedback-secondary');
    element.textContent = text;
    element.hidden = !text;
    if (text) element.setAttribute('data-tooltip', tooltip || text);
    else element.removeAttribute('data-tooltip');
    if (channel === 'primary') feedbackPrimaryPersistent = Boolean(text && persistent);
    else {
      feedbackSecondaryPersistent = Boolean(text && persistent);
      feedbackSecondaryScope = text ? (scope || '') : '';
      if (!text) feedbackSecondaryPriority = 0;
    }
  }
  function feedback(text = '', severity = 'info', persistent = false, channel = 'secondary', scope = '', tooltip = '') {
    if (!text) {
      setFeedbackLine('primary', '', false, '', '');
      setFeedbackLine('secondary', '', false, '', '');
      feedbackSecondaryPriority = 0;
      return;
    }
    if (channel === 'primary') {
      setFeedbackLine('primary', text, persistent, scope, tooltip);
      return;
    }
    const priority = feedbackPriority(severity);
    const currentText = $('feedback-secondary').textContent || '';
    if (currentText && priority < feedbackSecondaryPriority) return;
    feedbackSecondaryPriority = priority;
    setFeedbackLine('secondary', text, persistent, scope, tooltip);
  }
  function beginOperationFeedback() {
    setFeedbackLine('primary', '', false, '', '');
    if (feedbackSecondaryScope !== 'connection') {
      setFeedbackLine('secondary', '', false, '', '');
      feedbackSecondaryPriority = 0;
    }
  }
  function clearTransientFeedback() {
    if (!feedbackPrimaryPersistent) setFeedbackLine('primary', '', false, '', '');
    if (!feedbackSecondaryPersistent) {
      setFeedbackLine('secondary', '', false, '', '');
      feedbackSecondaryPriority = 0;
    }
  }
`;
}
