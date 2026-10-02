<script lang="ts">
  import type { AdminAccess, CmsgClient, MemberRole } from '../../../../core/src/cmsg.js';
  import { Button, Notice, TextField } from '../../../../ui/src/index.js';
  let { client, communityId }: { client: CmsgClient; communityId?: string } = $props();
  let view: AdminAccess | null = $state(null);
  let memberId = $state('');
  let nextRole: MemberRole | '' = $state('');
  let reason = $state('');
  let busy = $state(false);
  let error = $state('');
  let note = $state('');
  let generation = 0;

  $effect(() => {
    const scope = communityId;
    const request = ++generation;
    view = null; memberId = ''; nextRole = ''; reason = ''; error = ''; note = ''; busy = false;
    void client.adminAccess(scope).then(value => { if (request === generation) view = value; }, () => { if (request === generation) error = 'Admin controls are unavailable. Sign in again to retry.'; });
    return () => { ++generation; };
  });

  async function apply(kind: 'role' | 'handle') {
    if (busy) return;
    if (!memberId.trim() || (kind === 'role' && !nextRole) || (kind === 'handle' && !reason.trim())) {
      error = 'Choose a member and complete the requested change.'; return;
    }
    const request = generation;
    const scope = communityId;
    busy = true; error = ''; note = '';
    try {
      if (kind === 'role') {
        const updated = await client.adminSetRole(memberId.trim(), nextRole as MemberRole, scope);
        if (request !== generation) return;
        view = updated; note = 'Role updated.';
      } else {
        const notice = await client.requireHandleChange(memberId.trim(), reason.trim(), scope);
        if (request !== generation) return;
        note = `Change requested. The member chooses their handle. ${notice.deadlineLabel}.`;
      }
    } catch (e) { if (request === generation) error = e instanceof Error ? e.message : 'The change was not accepted.'; }
    finally { if (request === generation) busy = false; }
  }
</script>

<section aria-label="Membership controls">
  <h2>Membership controls</h2>
  <p>Admins may appoint admins. Only roots may appoint or remove roots.</p>
  {#if error}<Notice tone="error">{error}</Notice>{/if}
  {#if note}<Notice>{note}</Notice>{/if}
  {#if view}
    <ul>{#each view.members as member (member.id)}<li>{member.label}: {member.role}{#if !member.editable} (managed by a root){/if}</li>{/each}</ul>
    <fieldset disabled={busy}>
      <TextField id="role-member" label="Member ID" value={memberId} oninput={value => memberId = value} />
      <label for="member-role">Role</label>
      <select id="member-role" bind:value={nextRole}>
        <option value="">Choose a role</option>
        {#each view.assignableRoles as role}<option value={role}>{role}</option>{/each}
      </select>
      <Button disabled={busy} onclick={() => void apply('role')}>Set role</Button>
      {#if view.canRequireHandleChange}
        <h3>Require a handle change</h3>
        <p>The member chooses within 7 days. Otherwise a neutral placeholder is assigned. You cannot choose a name for them.</p>
        <TextField id="handle-reason" label="Reason for the member" value={reason} multiline oninput={value => reason = value} />
        <Button disabled={busy} onclick={() => void apply('handle')}>Require handle change</Button>
      {/if}
    </fieldset>
  {:else if !error}<p role="status">Loading membership controls…</p>{/if}
</section>

<style>
  fieldset { border: 0; padding: 0; display: grid; gap: 0.75rem; min-width: 0; }
  select { font: inherit; padding: 0.6rem; background: var(--cmeet-surface); color: var(--cmeet-ink); }
</style>
