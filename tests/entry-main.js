// CI-only entry: use the real controller, wallet and cvld/cmsg authentication.
// Only the unrelated profile/account/Tor network is replaced for this test.
import { mount } from 'svelte';
import App from '../src/App.svelte';
import { createAppController } from '../src/lib/app.js';
import '../src/styles.css';

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
globalThis.__cmeetEntryController = controller;
globalThis.__cmeetEntryAdmissions = admissions;
mount(App, { target: document.getElementById('app'), props: { controllerFactory: () => controller } });
