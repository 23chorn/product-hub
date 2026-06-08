export interface DemoEvent {
  type: string;
  label: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}
