<script lang="ts">
  /**
   * Generic editor for a JSON object. Every leaf value gets a control matching
   * its type; arrays of text become one line per item. `onSave` receives a new
   * object built from the same shape, so the server validates the same keys.
   */
  interface Props {
    value: Record<string, unknown>;
    onSave: (next: Record<string, unknown>) => Promise<void> | void;
    busy?: boolean;
  }

  let { value, onSave, busy = false }: Props = $props();

  type Leaf = { path: string[]; kind: 'string' | 'long' | 'number' | 'boolean' | 'lines' | 'json' | 'null'; text: string };

  function flatten(input: unknown, path: string[], out: Leaf[]) {
    if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
      for (const [key, child] of Object.entries(input)) flatten(child, [...path, key], out);
      return out;
    }
    if (typeof input === 'boolean') out.push({ path, kind: 'boolean', text: input ? 'true' : 'false' });
    else if (typeof input === 'number') out.push({ path, kind: 'number', text: String(input) });
    else if (input === null) out.push({ path, kind: 'null', text: '' });
    else if (Array.isArray(input) && input.every((item) => typeof item === 'string')) out.push({ path, kind: 'lines', text: input.join('\n') });
    else if (Array.isArray(input) || typeof input === 'object') out.push({ path, kind: 'json', text: JSON.stringify(input, null, 2) });
    else {
      const text = String(input);
      out.push({ path, kind: text.length > 90 || text.includes('\n') ? 'long' : 'string', text });
    }
    return out;
  }

  let leaves = $state<Leaf[]>([]);
  let error = $state('');

  $effect(() => {
    leaves = flatten(value, [], []);
  });

  function setPath(target: Record<string, any>, path: string[], leafValue: unknown) {
    let cursor = target;
    for (const key of path.slice(0, -1)) cursor = cursor[key];
    cursor[path[path.length - 1]!] = leafValue;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    const next = structuredClone(value) as Record<string, any>;
    try {
      for (const leaf of leaves) {
        let parsed: unknown = leaf.text;
        if (leaf.kind === 'number') parsed = Number(leaf.text) || 0;
        else if (leaf.kind === 'boolean') parsed = leaf.text === 'true';
        else if (leaf.kind === 'null') parsed = leaf.text.trim() ? leaf.text : null;
        else if (leaf.kind === 'lines') parsed = leaf.text.split('\n').map((line) => line.trim()).filter(Boolean);
        else if (leaf.kind === 'json') parsed = JSON.parse(leaf.text || 'null');
        setPath(next, leaf.path, parsed);
      }
    } catch {
      error = 'بعض الحقول بصيغة JSON غير صحيحة.';
      return;
    }
    await onSave(next);
  }

  function isLtr(text: string) {
    return /[a-z]/i.test(text) && !/[\u0600-\u06FF]/.test(text);
  }

  function labelOf(path: string[]) {
    return path.join(' ← ').replace(/([a-z])([A-Z])/g, '$1 $2');
  }
</script>

<form onsubmit={submit}>
  {#if error}<p class="adm-error" role="alert">{error}</p>{/if}
  {#each leaves as leaf, index (leaf.path.join('.'))}
    {#if leaf.kind === 'boolean'}
      <label class="adm-check" style="margin-bottom:12px">
        <input type="checkbox" checked={leaf.text === 'true'} onchange={(e) => (leaves[index]!.text = e.currentTarget.checked ? 'true' : 'false')} />
        {labelOf(leaf.path)}
      </label>
    {:else}
      <label class="adm-field">
        <span>{labelOf(leaf.path)}</span>
        {#if leaf.kind === 'long' || leaf.kind === 'lines' || leaf.kind === 'json'}
          <textarea class="adm-input {isLtr(leaf.text) ? 'ltr' : ''}" bind:value={leaves[index]!.text}></textarea>
        {:else}
          <input class="adm-input {/url|email|phone|whatsapp|handle|slug|key|id/i.test(leaf.path.join('.')) ? 'ltr' : ''}" type={leaf.kind === 'number' ? 'number' : 'text'} bind:value={leaves[index]!.text} />
        {/if}
        {#if leaf.kind === 'lines'}<small>سطر لكل عنصر.</small>{/if}
      </label>
    {/if}
  {/each}
  <button class="adm-btn primary" type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
</form>
