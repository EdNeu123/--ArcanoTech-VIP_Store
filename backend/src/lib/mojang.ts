/**
 * Resolve um nick de Minecraft (Java) pro UUID oficial via API da Mojang.
 * Fazemos isso no momento do checkout, e não depois do pagamento — se o
 * nick não existir, é melhor falhar antes de cobrar o cliente.
 */
export async function resolveMinecraftUuid(nick: string): Promise<string | null> {
  const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(nick)}`, {
    // Evita cache de borda servindo um resultado desatualizado (nick trocado)
    cache: "no-store",
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Mojang API respondeu ${res.status}`);
  }

  const data = (await res.json()) as { id: string; name: string };
  // A API da Mojang devolve o UUID sem hífens — normalizamos pro formato
  // padrão (8-4-4-4-12) que o resto do sistema espera.
  const raw = data.id.replace(/-/g, "");
  return [
    raw.slice(0, 8),
    raw.slice(8, 12),
    raw.slice(12, 16),
    raw.slice(16, 20),
    raw.slice(20, 32),
  ].join("-");
}
