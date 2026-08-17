import React, { useState } from "react"
import ReactDOM from "react-dom/client"
import "./primitives.css"
import "./playground.css"

const colors = [
  ["Pink", "--fl-color-pink", "#ff0fae"], ["Purple", "--fl-color-purple", "#7f26ff"],
  ["Cyan", "--fl-color-cyan", "#18d7ff"], ["Yellow", "--fl-color-yellow", "#ffe000"],
  ["Background", "--fl-color-bg", "#07050d"], ["Background alt", "--fl-color-bg-alt", "#100819"],
  ["Text", "--fl-color-text", "#f8f7ff"], ["Muted", "--fl-color-muted", "#a9a0ba"],
  ["Success", "--fl-color-success-landing", "#75e9b6"], ["Orange", "--fl-color-orange", "#ff6a00"],
]

const spaces = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 25, 28, 30, 34, 35, 36, 38, 40, 42, 48, 50, 55, 60, 65, 80, 82, 90, 115, 120]

function Playground(): JSX.Element {
  const [enabled, setEnabled] = useState(true)
  const [tab, setTab] = useState("biblioteca")
  return (
    <main className="ds-page">
      <header className="ds-hero">
        <p className="fl-eyebrow">FLIPERAMA / FASE 1</p>
        <h1 className="fl-heading-display">Design system<br /><span>oficial.</span></h1>
        <p>Playground isolado. Esta entrada não é importada nem acessível pela navegação do aplicativo.</p>
      </header>

      <section className="ds-section" id="colors">
        <p className="fl-eyebrow">TOKENS PRIMITIVOS</p><h2>Cores principais</h2>
        <div className="ds-swatches">{colors.map(([label, token, value]) => <article className="ds-swatch" key={token}><i style={{ background: `var(${token})` }} /><b>{label}</b><code>{token}</code><small>{value}</small></article>)}</div>
      </section>

      <section className="ds-section" id="gradients">
        <p className="fl-eyebrow">COMPOSIÇÕES</p><h2>Gradientes extraídos</h2>
        <div className="ds-gradients"><div style={{ background: "var(--fl-gradient-brand)" }}>brand</div><div style={{ background: "var(--fl-gradient-spectrum)" }}>spectrum</div><div style={{ background: "var(--fl-gradient-progress)" }}>progress</div></div>
      </section>

      <section className="ds-section" id="type">
        <p className="fl-eyebrow">TIPOGRAFIA LOCAL</p><h2>Inter + Bebas Neue</h2>
        <div className="fl-panel ds-type"><h3 className="fl-heading-display">Jogue mais.</h3><p>Inter mantém controles, tabelas e conteúdo legíveis em uma interface desktop densa.</p><strong>400 · 500 · 600 · 700 · 800</strong></div>
      </section>

      <section className="ds-section" id="controls">
        <p className="fl-eyebrow">PRIMITIVAS</p><h2>Controles e estados</h2>
        <div className="fl-panel ds-stack">
          <div className="ds-row"><button className="fl-button fl-button-primary">Ação principal ↗</button><button className="fl-button">Ação ghost</button><button className="fl-button fl-button-danger">Destrutivo</button><button className="fl-button" disabled>Disabled</button></div>
          <div className="ds-grid-2"><input className="fl-input" aria-label="Campo de exemplo" placeholder="Campo de texto" /><select className="fl-select" aria-label="Seleção de exemplo"><option>UMU-Proton</option><option>GE-Proton</option></select></div>
          <div className="ds-row"><span className="fl-badge">Destaque</span><span className="fl-badge fl-badge-success">Online</span><span className="fl-badge fl-badge-highlight">Oferta</span><button className="fl-switch" aria-label="Exemplo de switch" aria-pressed={enabled} onClick={() => setEnabled(!enabled)} /></div>
          <div className="fl-tabs" role="tablist">{["biblioteca", "launchers", "loja"].map((item) => <button className="fl-tab" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} key={item}>{item}</button>)}</div>
          <div className="fl-progress" aria-label="Progresso: 82%"><i style={{ width: "82%" }} /></div>
        </div>
      </section>

      <section className="ds-section" id="surfaces">
        <p className="fl-eyebrow">SUPERFÍCIES</p><h2>Cards e tabela</h2>
        <div className="ds-card-grid">{["Performance", "Ferramentas", "Backup"].map((label) => <article className="fl-card" key={label}><span className="fl-badge">Módulo</span><h3>{label}</h3><p>Superfície reutilizável, sem blur e sem animação contínua.</p></article>)}</div>
        <div className="fl-panel ds-table-wrap"><table className="fl-table"><thead><tr><th>Componente</th><th>Estado</th><th>Token</th></tr></thead><tbody><tr><td>Botão</td><td>Ativo</td><td><code>--fl-gradient-brand</code></td></tr><tr><td>Painel</td><td>Padrão</td><td><code>--fl-gradient-panel</code></td></tr></tbody></table></div>
      </section>

      <section className="ds-section" id="spacing">
        <p className="fl-eyebrow">ESCALA LITERAL</p><h2>Espaçamentos</h2>
        <div className="fl-panel ds-spacing">{spaces.map((space, index) => <div key={space}><code>--fl-space-{index + 1}</code><i style={{ width: space }} /><span>{space}px</span></div>)}</div>
      </section>

      <section className="ds-section" id="stress">
        <p className="fl-eyebrow">PROVA DE CUSTO VISUAL</p><h2>100 cards sem filtros pesados</h2>
        <div className="ds-stress-grid">{Array.from({ length: 100 }, (_, index) => <div className="ds-stress-card" key={index}><i /><span>GAME {String(index + 1).padStart(3, "0")}</span></div>)}</div>
      </section>
    </main>
  )
}

ReactDOM.createRoot(document.getElementById("design-system-root") as HTMLElement).render(<React.StrictMode><Playground /></React.StrictMode>)
