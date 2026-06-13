<script lang="ts">
  import "../app.css";
  import { AppChrome, Footer, Link } from "@sentropic/design-system-svelte";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  const nav = [
    { label: "Catalogue", href: "/", active: true },
  ];
</script>

<div class="site">
  <AppChrome
    brandName="Sent Tech"
    productName="géo"
    brandHref="/"
    {nav}
    navLabel="Navigation principale"
    githubHref="https://github.com/rhanka/geo"
    githubLabel="Code source sur GitHub"
  />

  <main class="site-main" id="contenu">
    {@render children()}
  </main>

  <Footer copyright={`© ${new Date().getFullYear()} Sent Tech — données sous licence ouverte`} label="Pied de page">
    {#snippet legal()}
      <Link href="https://geo.sent-tech.ca" variant="muted" external>geo.sent-tech.ca</Link>
    {/snippet}
  </Footer>
</div>

<style>
  .site {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .site-main {
    flex: 1 1 auto;
    width: 100%;
  }
</style>
