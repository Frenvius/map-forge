import brush from '~/components/commons/icons/brush.svg?raw';

export const DRAW_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(brush)}") 4 20, crosshair`;

const PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="#60a5fa" stroke="#0b1a33" stroke-width="1.5"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3" fill="#0b1a33"/></svg>';

export const WAYPOINT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(PIN_SVG)}") 14 27, crosshair`;
