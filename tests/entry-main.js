// CI-only entry: use the real controller, wallet and cvld/cmsg authentication.
// Only the unrelated profile/account/Tor network is replaced for this test.
import { mount } from 'svelte';
import App from '../src/App.svelte';
import { createAppController } from '../src/lib/app.js';
import '../src/styles.css';

const progress = [];
function mark(stage, state) {
  // Fixed stage names and public state flags only: no voucher, challenge,
  // wallet, assertion, credential or private cmsg snapshot enters diagnostics.
  const event = { stage, ...(state ? { ready: state.ready, busy: state.busy,
    authenticated: state.authenticated, hasError: Boolean(state.error) } : {}) };
  if (progress.length < 40) progress.push(event);
  console.info('CMEET_ENTRY_STAGE ' + JSON.stringify(event));
}
globalThis.__cmeetEntryProgress = progress;
mark('entry-imports-complete');
const admissions = [];
const controller = createAppController({
  networkFactory({ device, authority, onConnectivity, onAccounting }) {
    // These getters read the real bound cmsg credential after registration or
    // restored login; never substitute a flag for successful device renewal.
    admissions.push({ memberId: device.memberId(), chatPublicKey: [...device.chatPublicKey()],
      authority: structuredClone(authority) });
    return {
      async start() {
        onConnectivity({ online: false, status: 'offline' });
        onAccounting({ status: 'unknown', accepted: null, eligibleAt: null });
      },
      async close() {},
    };
  },
});
mark('controller-created');
let previousState;
controller.subscribe(state => {
  const flags = JSON.stringify([state.ready, state.busy, state.authenticated, Boolean(state.error)]);
  if (flags !== previousState) { previousState = flags; mark('controller-state', state); }
});
globalThis.__cmeetEntryController = controller;
globalThis.__cmeetEntryAdmissions = admissions;
mount(App, { target: document.getElementById('app'), props: { controllerFactory: () => ({
  ...controller,
  async init(...args) {
    mark('controller-init-start');
    try { return await controller.init(...args); }
    finally { mark('controller-init-finished', controller.getState()); }
  },
}) } });
mark('app-mounted');
