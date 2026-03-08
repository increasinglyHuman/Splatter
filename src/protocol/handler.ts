/**
 * PostMessage protocol handler — ADR-003 implementation.
 * Receives messages from host, dispatches to app, sends responses.
 */

import type {
  SplatPainterInit,
  SplatPainterUpdatePermissions,
  SplatPainterUpdateInfluences,
  InboundMessage,
} from '../types/index.js';

const PROTOCOL_VERSION = '1.0.0';

export type InitHandler = (msg: SplatPainterInit) => void;
export type PermissionsHandler = (msg: SplatPainterUpdatePermissions) => void;
export type InfluencesHandler = (msg: SplatPainterUpdateInfluences) => void;

export interface ProtocolHandlers {
  onInit: InitHandler;
  onUpdatePermissions: PermissionsHandler;
  onUpdateInfluences: InfluencesHandler;
}

export class ProtocolHandler {
  private hostOrigin: string | null = null;
  private handlers: ProtocolHandlers;
  private boundListener: (e: MessageEvent) => void;

  constructor(handlers: ProtocolHandlers) {
    this.handlers = handlers;
    this.boundListener = this.onMessage.bind(this);
    window.addEventListener('message', this.boundListener);
  }

  private onMessage(e: MessageEvent): void {
    const data = e.data;
    if (!data || typeof data.type !== 'string') return;

    // Lock to first host origin (security: reject messages from unknown origins)
    if (data.type === 'SPLATPAINTER_INIT') {
      this.hostOrigin = e.origin;
    } else if (this.hostOrigin && e.origin !== this.hostOrigin) {
      return; // silently drop
    }

    switch (data.type as InboundMessage['type']) {
      case 'SPLATPAINTER_INIT':
        this.handlers.onInit(data as SplatPainterInit);
        break;
      case 'SPLATPAINTER_UPDATE_PERMISSIONS':
        this.handlers.onUpdatePermissions(data as SplatPainterUpdatePermissions);
        break;
      case 'SPLATPAINTER_UPDATE_INFLUENCES':
        this.handlers.onUpdateInfluences(data as SplatPainterUpdateInfluences);
        break;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(message: Record<string, any> & { type: string }): void {
    const full = {
      ...message,
      version: PROTOCOL_VERSION,
      timestamp: Date.now(),
    };
    const target = this.hostOrigin ?? '*';
    window.parent.postMessage(full, target);
  }

  destroy(): void {
    window.removeEventListener('message', this.boundListener);
  }
}

export { PROTOCOL_VERSION };
