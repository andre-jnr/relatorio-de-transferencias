/* Relatório de transferências — busca o mês no servidor e faz todos os filtros aqui no navegador. */
(() => {
  "use strict";

  const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto",
    "Setembro", "Outubro", "Novembro", "Dezembro"];
  const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const inteiro = new Intl.NumberFormat("pt-BR");
  const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
  const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, um, varios) => `${inteiro.format(n)} ${n === 1 ? um : varios}`;
  const dataBR = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

  const estado = {
    dados: null,
    filial: "",
    ordem: { produtos: { campo: "valor", asc: false }, notas: { campo: "data", asc: false } },
    req: null,
    visao: null, // último cálculo (usado pelo CSV)
  };

  // ------------------------------------------------------------------
  // Filtros
  // ------------------------------------------------------------------
  function montarFiltros() {
    const hoje = new Date();
    const url = new URLSearchParams(location.search);
    const ano = +url.get("ano") || hoje.getFullYear();
    const mes = +url.get("mes") || hoje.getMonth() + 1;

    $("f-mes").innerHTML = MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
    const anos = [];
    for (let a = hoje.getFullYear(); a >= 2020; a--) anos.push(`<option value="${a}">${a}</option>`);
    $("f-ano").innerHTML = anos.join("");
    $("f-mes").value = mes;
    $("f-ano").value = ano;
    estado.lojaInicial = url.get("loja") || "";
    estado.grupoInicial = url.get("grupo") || "";
  }

  function lembrarNaUrl() {
    const p = new URLSearchParams({ ano: $("f-ano").value, mes: $("f-mes").value });
    if ($("f-loja").value) p.set("loja", $("f-loja").value);
    if ($("f-grupo").value) p.set("grupo", $("f-grupo").value);
    history.replaceState(null, "", "?" + p);
  }

  async function carregarLojas() {
    try {
      const lojas = await (await fetch("api/lojas")).json();
      $("f-loja").insertAdjacentHTML("beforeend", lojas.map((l) => `<option value="${esc(l.slug)}">${esc(l.nome)}</option>`).join(""));
      if (lojas.some((l) => l.slug === estado.lojaInicial)) $("f-loja").value = estado.lojaInicial;
    } catch (e) { /* o erro aparece na busca do mês */ }
  }

  // ------------------------------------------------------------------
  // Busca no servidor
  // ------------------------------------------------------------------
  async function buscar(atualizar = false) {
    const ano = +$("f-ano").value, mes = +$("f-mes").value;
    const hoje = new Date();
    $("periodo").textContent = `${MESES[mes - 1]} de ${ano}`;
    if (ano * 12 + mes > hoje.getFullYear() * 12 + hoje.getMonth() + 1) {
      estado.dados = { lojas: [] };
      avisar(["Esse mês ainda não começou."]);
      desenhar();
      return;
    }

    if (estado.req) estado.req.abort();
    const req = (estado.req = new AbortController());
    carregando(true);
    try {
      const resp = await fetch(`api/transferencias?ano=${ano}&mes=${mes}${atualizar ? "&atualizar=1" : ""}`, { signal: req.signal });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.erro || "Falha ao buscar os dados.");
      estado.dados = json;
      avisar(json.lojas.filter((l) => l.erro).map((l) => `${l.nome}: ${l.erro}. As transferências dessa loja ficaram de fora.`));
    } catch (e) {
      if (e.name === "AbortError") return;
      estado.dados = { lojas: [] };
      avisar([e.message === "Failed to fetch" ? "O servidor do relatório não respondeu." : e.message]);
    } finally {
      if (estado.req === req) { estado.req = null; carregando(false); }
    }
    desenhar();
  }

  function carregando(sim) {
    $("atualizar").disabled = sim;
    $("atualizar").classList.toggle("girando", sim);
    $("sankey").classList.toggle("carregando", sim);
    if (sim && !estado.dados) $("sankey").innerHTML = `<div class="vazio">Carregando…</div>`;
  }

  function avisar(msgs) {
    $("avisos").innerHTML = msgs.map((m) => `<div class="aviso">${esc(m)}</div>`).join("");
  }

  // ------------------------------------------------------------------
  // Cálculo (loja, grupo e filial são filtrados aqui)
  // ------------------------------------------------------------------
  function calcular() {
    const lojaSel = $("f-loja").value;
    const lojas = (estado.dados?.lojas || []).filter((l) => !l.erro && (!lojaSel || l.loja === lojaSel));

    // grupos disponíveis para as lojas escolhidas (pela descrição: os códigos mudam entre lojas)
    const grupos = new Set();
    lojas.forEach((l) => l.itens.forEach((i) => grupos.add(i.grupo)));
    atualizarGrupos([...grupos].sort((a, b) => a.localeCompare(b, "pt-BR")));
    const grupo = $("f-grupo").value;

    let notas = [], itens = [];
    for (const l of lojas) {
      const porNota = new Map();
      for (const i of l.itens) {
        if (grupo && i.grupo !== grupo) continue;
        const chave = `${l.loja}:${i.nota}`;
        itens.push({ ...i, nota: chave, origem: l.nome });
        porNota.set(chave, (porNota.get(chave) || 0) + i.valor);
      }
      for (const n of l.notas) {
        const chave = `${l.loja}:${n.id}`;
        if (grupo && !porNota.has(chave)) continue;
        notas.push({ ...n, chave, origem: l.nome, valor: grupo ? round2(porNota.get(chave)) : n.valor });
      }
    }

    // Sankey e contagem por filial: todas as filiais (o filtro de filial só destaca)
    const destinoDa = new Map(notas.map((n) => [n.chave, n.destino]));
    const fluxo = itens.map((i) => ({ origem: i.origem, grupo: i.grupo, destino: destinoDa.get(i.nota), valor: i.valor }));
    const notasPorOrigem = new Map();
    notas.forEach((n) => notasPorOrigem.set(n.origem, (notasPorOrigem.get(n.origem) || 0) + 1));
    const filiais = new Map();
    for (const n of notas) {
      const f = filiais.get(n.destino) || { nome: n.destino, valor: 0, notas: 0, origens: new Set() };
      f.valor += n.valor; f.notas++; f.origens.add(n.origem);
      filiais.set(n.destino, f);
    }
    const listaFiliais = [...filiais.values()].sort((a, b) => b.valor - a.valor);
    if (estado.filial && !filiais.has(estado.filial)) estado.filial = "";

    // tabelas e indicadores seguem também o filtro de filial
    if (estado.filial) {
      notas = notas.filter((n) => n.destino === estado.filial);
      const chaves = new Set(notas.map((n) => n.chave));
      itens = itens.filter((i) => chaves.has(i.nota));
    }

    const produtos = new Map();
    for (const i of itens) {
      const k = `${i.codigo}|${i.descricao}`;
      const p = produtos.get(k) || { codigo: i.codigo, descricao: i.descricao, grupo: i.grupo, unidades: new Map(), qtde: 0, valor: 0 };
      p.qtde += i.qtde; p.valor += i.valor;
      p.unidades.set(i.unidade, (p.unidades.get(i.unidade) || 0) + i.qtde);
      produtos.set(k, p);
    }

    return { notas, produtos: [...produtos.values()], filiais: listaFiliais, fluxo, notasPorOrigem,
      lojasComNota: new Set(notas.map((n) => n.origem)) };
  }

  const round2 = (v) => Math.round(v * 100) / 100;

  function atualizarGrupos(grupos) {
    const sel = $("f-grupo");
    const atual = sel.value || estado.grupoInicial;
    estado.grupoInicial = "";
    sel.innerHTML = `<option value="">Todos os grupos</option>` + grupos.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join("");
    sel.value = grupos.includes(atual) ? atual : "";
  }

  // ------------------------------------------------------------------
  // Desenho
  // ------------------------------------------------------------------
  function desenhar() {
    const v = (estado.visao = calcular());
    lembrarNaUrl();
    desenharKpis(v);
    desenharSankey(v);
    desenharChip();
    desenharProdutos(v.produtos);
    desenharNotas(v.notas);
  }

  function desenharKpis(v) {
    const total = v.notas.reduce((s, n) => s + n.valor, 0);
    $("k-total").textContent = moeda.format(total);
    $("k-total-sub").textContent = v.notas.length ? `média de ${moeda.format(total / v.notas.length)} por nota` : "nenhuma transferência";
    $("k-notas").textContent = inteiro.format(v.notas.length);
    $("k-notas-sub").textContent = v.lojasComNota.size ? `emitidas por ${plural(v.lojasComNota.size, "loja", "lojas")}` : " ";
    const destinos = estado.filial ? 1 : v.filiais.length;
    $("k-filiais").textContent = inteiro.format(destinos);
    $("k-filiais-sub").textContent = estado.filial ? estado.filial : v.filiais[0] ? `maior: ${v.filiais[0].nome}` : " ";
    $("k-produtos").textContent = inteiro.format(v.produtos.length);
    const grupos = new Set(v.produtos.map((p) => p.grupo)).size;
    $("k-produtos-sub").textContent = grupos ? `de ${plural(grupos, "grupo", "grupos")}` : " ";
  }

  // ---------- Sankey: loja emissora → grupo → filial de destino ----------
  // Cada loja tem a mesma cor como origem e como destino (ordem fixa, nunca pela posição)
  const COR_LOJA = { "Parque Dez": "--c1", "Ponta Negra": "--c2", "Morada do Sol": "--c3",
    "Monte das Oliveiras": "--c4", "Flores": "--c5", "CD": "--c6" };
  const MAX_GRUPOS = 7; // os demais viram "Outros grupos"
  const OUTROS = "Outros grupos";
  const SVG = "http://www.w3.org/2000/svg";
  const semMovimento = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  let ultimoTamanho = 0;

  function corDe(no) {
    return no.coluna === 1 ? "var(--grupo)" : `var(${COR_LOJA[no.nome] || "--grupo"})`;
  }

  function montarSankey(v) {
    const somar = (mapa, k, val) => mapa.set(k, (mapa.get(k) || 0) + val);
    const porGrupo = new Map();
    v.fluxo.forEach((f) => somar(porGrupo, f.grupo, f.valor));
    const principais = new Set([...porGrupo].sort((a, b) => b[1] - a[1]).slice(0, MAX_GRUPOS).map(([g]) => g));
    const grupoDe = (g) => (principais.has(g) || porGrupo.size <= MAX_GRUPOS + 1 ? g : OUTROS);

    const nos = new Map();
    const no = (coluna, nome) => {
      const id = `${coluna}|${nome}`;
      if (!nos.has(id)) nos.set(id, { id, coluna, nome, valor: 0, saidas: [], entradas: [] });
      return nos.get(id);
    };
    const ligacoes = new Map();
    const ligar = (a, b, val) => {
      const id = `${a.id}>${b.id}`;
      let l = ligacoes.get(id);
      if (!l) { l = { origem: a, destino: b, valor: 0 }; ligacoes.set(id, l); a.saidas.push(l); b.entradas.push(l); }
      l.valor += val;
    };
    for (const f of v.fluxo) {
      if (f.valor <= 0) continue;
      const a = no(0, f.origem), g = no(1, grupoDe(f.grupo)), d = no(2, f.destino);
      ligar(a, g, f.valor); ligar(g, d, f.valor);
    }
    for (const n of nos.values()) n.valor = Math.max(n.saidas.reduce((s, l) => s + l.valor, 0), n.entradas.reduce((s, l) => s + l.valor, 0));
    const colunas = [0, 1, 2].map((c) => [...nos.values()].filter((n) => n.coluna === c)
      .sort((a, b) => (a.nome === OUTROS) - (b.nome === OUTROS) || b.valor - a.valor));
    return { colunas, ligacoes: [...ligacoes.values()] };
  }

  function desenharSankey(v) {
    const caixa = $("sankey");
    caixa.classList.remove("destacando");
    const { colunas, ligacoes } = montarSankey(v);
    if (!ligacoes.length) {
      caixa.innerHTML = `<div class="vazio">Nenhuma transferência com esses filtros.</div>`;
      return;
    }

    // ---- layout ----
    const L = caixa.clientWidth || 900;
    const estreito = L < 640;
    const NO = 12, TOPO = 30, ESPACO = estreito ? 10 : 14;
    const rotuloDir = estreito ? 120 : 190; // espaço dos rótulos da última coluna
    const maxNos = Math.max(...colunas.map((c) => c.length));
    const A = Math.max(300, Math.min(estreito ? 460 : 540, maxNos * 62));
    const total = colunas[0].reduce((s, n) => s + n.valor, 0);
    const k = Math.min(...colunas.map((c) => (A - ESPACO * (c.length - 1)) / total));
    const xs = [0, Math.round((L - rotuloDir - NO) / 2), L - rotuloDir - NO];
    colunas.forEach((col, c) => {
      const usado = col.reduce((s, n) => s + Math.max(n.valor * k, 2), 0) + ESPACO * (col.length - 1);
      let y = TOPO + (A - usado) / 2;
      col.forEach((n) => { n.x = xs[c]; n.y = y; n.h = Math.max(n.valor * k, 2); y += n.h + ESPACO; });
    });
    // fitas saem e chegam na ordem vertical do outro lado (menos cruzamentos)
    colunas.flat().forEach((n) => {
      let ys = n.y;
      n.saidas.sort((a, b) => a.destino.y - b.destino.y).forEach((l) => { l.sy = ys; ys += l.valor * k; });
      let ye = n.y;
      n.entradas.sort((a, b) => a.origem.y - b.origem.y).forEach((l) => { l.ty = ye; ye += l.valor * k; });
    });

    // ---- SVG ----
    const altura = TOPO + A + 8;
    const animar = !semMovimento();
    let defs = "", fitas = "", nosSvg = "", rotulos = "";
    ligacoes.forEach((l, i) => {
      const x0 = l.origem.x + NO, x1 = l.destino.x, xm = (x0 + x1) / 2, w = Math.max(l.valor * k, 1);
      const d = `M${x0},${l.sy}C${xm},${l.sy} ${xm},${l.ty} ${x1},${l.ty}L${x1},${l.ty + w}C${xm},${l.ty + w} ${xm},${l.sy + w} ${x0},${l.sy + w}Z`;
      defs += `<linearGradient id="sk-g${i}" gradientUnits="userSpaceOnUse" x1="${x0}" x2="${x1}" y1="0" y2="0">
        <stop offset="0" style="stop-color:${corDe(l.origem)}"/><stop offset="1" style="stop-color:${corDe(l.destino)}"/></linearGradient>`;
      fitas += `<g class="sk-fita" data-l="${i}"><path class="base" d="${d}" fill="url(#sk-g${i})"/>` +
        (animar ? `<path class="brilho" d="${d}" fill="url(#sk-brilho${l.origem.coluna})"/>` : "") + `</g>`;
    });
    // brilho que corre no sentido do fluxo, um por vão entre colunas (defasados)
    if (animar) {
      [0, 1].forEach((c) => {
        const x0 = xs[c] + NO, x1 = xs[c + 1], vao = x1 - x0;
        defs += `<linearGradient id="sk-brilho${c}" gradientUnits="userSpaceOnUse" x1="${x0}" x2="${x0 + vao * 0.45}" y1="0" y2="0">
          <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" style="stop-color:var(--brilho)"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
          <animateTransform attributeName="gradientTransform" type="translate" values="${-vao * 0.5} 0;${vao * 1.05} 0"
            dur="3.6s" begin="${c * 1.2}s" repeatCount="indefinite"/></linearGradient>`;
      });
    }
    // entrada: as fitas se desenham da esquerda para a direita
    defs += `<clipPath id="sk-entrada"><rect x="-4" y="0" height="${altura}" width="${animar ? 0 : L + 8}">${animar
      ? `<animate attributeName="width" from="0" to="${L + 8}" dur="1.1s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".23 1 .32 1"/>` : ""}</rect></clipPath>`;

    colunas.flat().forEach((n) => {
      nosSvg += `<g class="sk-no" data-n="${esc(n.id)}"><rect x="${n.x}" y="${n.y}" width="${NO}" height="${n.h}" rx="3" style="fill:${corDe(n)}"/>
        <rect x="${n.x - 6}" y="${n.y - 4}" width="${NO + 12}" height="${n.h + 8}" fill="transparent"/></g>`;
      const ultima = n.coluna === 2;
      const tx = ultima ? n.x + NO + 10 : n.x + NO + 8;
      const cy = n.y + n.h / 2;
      const sub = n.coluna === 0 ? ` · ${plural(v.notasPorOrigem.get(n.nome) || 0, "nota", "notas")}`
        : n.coluna === 2 ? ` · ${plural(v.filiais.find((f) => f.nome === n.nome)?.notas || 0, "nota", "notas")}` : "";
      const nome = estreito && n.nome.length > 16 ? n.nome.slice(0, 15) + "…" : n.nome;
      const duasLinhas = n.h >= 26 || ultima;
      n.rotulo = { tx, cy, alt: duasLinhas ? 32 : 17, html: (y) => `<text class="sk-rotulo" x="${tx}" y="${duasLinhas ? y - 2 : y + 4}">
        <tspan class="nome">${esc(nome)}</tspan>${duasLinhas
          ? `<tspan class="valor" x="${tx}" dy="15">${moeda.format(n.valor)}${estreito ? "" : sub}</tspan>` : ""}</text>` };
    });
    // rótulos de nós pequenos e vizinhos não podem se sobrepor: empurra para baixo e, se passar do fim, para cima
    colunas.forEach((col) => {
      const rs = col.map((n) => n.rotulo);
      rs.forEach((r, i) => { r.y = i ? Math.max(r.cy, rs[i - 1].y + (rs[i - 1].alt + r.alt) / 2) : r.cy; });
      for (let i = rs.length - 1, limite = TOPO + A + 4; i >= 0; i--) {
        const max = (i === rs.length - 1 ? limite : rs[i + 1].y - rs[i + 1].alt / 2) - rs[i].alt / 2;
        if (rs[i].y > max) rs[i].y = max;
      }
      rotulos += rs.map((r) => r.html(r.y)).join("");
    });

    const cabecalho = ["Loja emissora", "Grupo de produto", "Filial de destino"]
      .map((t, c) => `<text class="sk-coluna" x="${xs[c]}" y="12">${t}</text>`).join("");

    caixa.innerHTML = `<svg viewBox="0 0 ${L} ${altura}" height="${altura}" aria-hidden="true">
      <defs>${defs}</defs>${cabecalho}
      <g clip-path="url(#sk-entrada)">${fitas}</g>${nosSvg}${rotulos}</svg>`;
    ultimoTamanho = L;

    // ---- interação ----
    const marcarFoco = (ls, ns) => {
      caixa.classList.add("destacando");
      caixa.querySelectorAll(".sk-fita").forEach((el) => el.classList.toggle("foco", ls.has(+el.dataset.l)));
      caixa.querySelectorAll(".sk-no").forEach((el) => el.classList.toggle("foco", ns.has(el.dataset.n)));
    };
    const limparFoco = () => {
      caixa.classList.remove("destacando");
      caixa.querySelectorAll(".foco").forEach((el) => el.classList.remove("foco"));
      esconderDica();
      focoFilial();
    };
    const parte = (val) => pct.format(total ? val / total : 0);

    caixa.querySelectorAll(".sk-fita").forEach((el) => {
      const l = ligacoes[+el.dataset.l];
      el.addEventListener("mouseenter", () => marcarFoco(new Set([+el.dataset.l]), new Set([l.origem.id, l.destino.id])));
      el.addEventListener("mousemove", (e) => mostrarDica(e, `<h3>${esc(l.origem.nome)} → ${esc(l.destino.nome)}</h3><dl>
        <dt>Valor</dt><dd>${moeda.format(l.valor)}</dd><dt>Participação</dt><dd>${parte(l.valor)}</dd></dl>`));
      el.addEventListener("mouseleave", limparFoco);
    });

    // passar sobre um nó acende só as fitas ligadas a ele (o resto do grupo mistura outras lojas)
    const caminho = (n) => {
      const ls = [...n.saidas, ...n.entradas];
      return { ls: new Set(ls.map((l) => ligacoes.indexOf(l))), ns: new Set([n.id, ...ls.map((l) => (l.origem === n ? l.destino : l.origem).id)]) };
    };
    const nosPorId = new Map(colunas.flat().map((n) => [n.id, n]));
    caixa.querySelectorAll(".sk-no").forEach((el) => {
      const n = nosPorId.get(el.dataset.n);
      el.addEventListener("mouseenter", () => { const c = caminho(n); marcarFoco(c.ls, c.ns); });
      el.addEventListener("mousemove", (e) => {
        const notas = n.coluna === 0 ? v.notasPorOrigem.get(n.nome) : n.coluna === 2 ? v.filiais.find((f) => f.nome === n.nome)?.notas : null;
        mostrarDica(e, `<h3>${esc(n.nome)}</h3><dl><dt>Valor</dt><dd>${moeda.format(n.valor)}</dd>
          <dt>Participação</dt><dd>${parte(n.valor)}</dd>${notas != null ? `<dt>Notas</dt><dd>${inteiro.format(notas)}</dd>
          <dt>Média por nota</dt><dd>${moeda.format(n.valor / (notas || 1))}</dd>` : ""}</dl>`);
      });
      el.addEventListener("mouseleave", limparFoco);
      el.addEventListener("click", () => filtrarPeloNo(n));
    });

    // com uma filial escolhida, o caminho dela fica aceso
    function focoFilial() {
      const d = estado.filial && nosPorId.get(`2|${estado.filial}`);
      if (d) { const c = caminho(d); marcarFoco(c.ls, c.ns); }
    }
    focoFilial();
  }

  // clique: loja emissora → filtro de loja; grupo → filtro de grupo; filial → filtro de filial
  function filtrarPeloNo(n) {
    esconderDica();
    if (n.coluna === 0) {
      const opcao = [...$("f-loja").options].find((o) => o.textContent === n.nome);
      if (opcao) $("f-loja").value = $("f-loja").value === opcao.value ? "" : opcao.value;
    } else if (n.coluna === 1) {
      if (n.nome === OUTROS) return;
      $("f-grupo").value = $("f-grupo").value === n.nome ? "" : n.nome;
    } else {
      estado.filial = estado.filial === n.nome ? "" : n.nome;
    }
    desenhar();
  }

  // redesenha ao mudar a largura (o SVG é medido em pixels para os rótulos não esticarem)
  let esperaResize;
  addEventListener("resize", () => {
    clearTimeout(esperaResize);
    esperaResize = setTimeout(() => {
      if (estado.visao && Math.abs($("sankey").clientWidth - ultimoTamanho) > 20) desenharSankey(estado.visao);
    }, 150);
  });

  function desenharChip() {
    $("chip-filial").innerHTML = estado.filial
      ? `<button type="button" class="chip" title="Limpar filtro de filial">Destino: ${esc(estado.filial)} <b aria-hidden="true">×</b></button>` : "";
    const chip = $("chip-filial").firstElementChild;
    if (chip) chip.addEventListener("click", () => { estado.filial = ""; desenhar(); });
  }

  function mostrarDica(e, html) {
    const d = $("dica");
    d.innerHTML = html;
    d.hidden = false;
    const w = d.offsetWidth, h = d.offsetHeight;
    let x = e.clientX + 16, y = e.clientY - h - 12;
    if (x + w > innerWidth - 8) x = e.clientX - w - 16;
    if (y < 8) y = e.clientY + 18;
    d.style.left = `${Math.max(8, x)}px`;
    d.style.top = `${y}px`;
  }
  function esconderDica() { $("dica").hidden = true; }

  // ---------- tabelas ----------
  function ordenar(lista, tabela) {
    const { campo, asc } = estado.ordem[tabela];
    const sinal = asc ? 1 : -1;
    return [...lista].sort((a, b) => {
      const x = a[campo], y = b[campo];
      const r = typeof x === "number" && typeof y === "number" ? x - y
        : String(x).localeCompare(String(y), "pt-BR", { numeric: true });
      return r * sinal;
    });
  }

  function marcarOrdem(tabela, id) {
    const { campo, asc } = estado.ordem[tabela];
    $(id).querySelectorAll("th").forEach((th) => {
      if (th.dataset.ord === campo) th.setAttribute("aria-sort", asc ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    });
  }

  const qtdeTexto = (p) => [...p.unidades].map(([u, q]) => `${decimal.format(q)}${u ? " " + esc(u) : ""}`).join(" + ");

  function desenharProdutos(produtos) {
    const busca = norm($("prod-busca").value);
    const lista = ordenar(produtos.filter((p) => !busca || norm(`${p.codigo} ${p.descricao}`).includes(busca)), "produtos");
    marcarOrdem("produtos", "t-produtos");
    const total = lista.reduce((s, p) => s + p.valor, 0);
    $("prod-resumo").textContent = `${plural(lista.length, "produto", "produtos")} · ${moeda.format(total)}`;
    const corpo = $("t-produtos").querySelector("tbody");
    corpo.innerHTML = lista.length
      ? lista.map((p) => `<tr>
          <td class="cod">${esc(p.codigo)}</td>
          <td>${esc(p.descricao)}<span class="sub">${esc(p.grupo)}</span></td>
          <td class="num">${qtdeTexto(p)}</td>
          <td class="num">${moeda.format(p.valor)}</td></tr>`).join("")
      : `<tr><td colspan="4" class="vazio">Nenhum produto.</td></tr>`;
    rodape("t-produtos", lista.length ? `<td colspan="3">Total</td><td class="num">${moeda.format(total)}</td>` : "");
  }

  function desenharNotas(notas) {
    const busca = norm($("nf-busca").value);
    const lista = ordenar(
      notas.map((n) => ({ ...n, rota: `${n.origem} → ${n.destino}` }))
        .filter((n) => !busca || norm(`${n.nf} ${n.rota}`).includes(busca)), "notas");
    marcarOrdem("notas", "t-notas");
    const total = lista.reduce((s, n) => s + n.valor, 0);
    $("nf-resumo").textContent = `${plural(lista.length, "nota", "notas")} · ${moeda.format(total)}`;
    const corpo = $("t-notas").querySelector("tbody");
    corpo.innerHTML = lista.length
      ? lista.map((n) => `<tr>
          <td class="cod">${esc(n.nf)}</td>
          <td>${dataBR(n.data)}</td>
          <td>${esc(n.origem)} → ${esc(n.destino)}<span class="sub">CFOP ${esc(n.cfop)}</span></td>
          <td class="num">${moeda.format(n.valor)}</td></tr>`).join("")
      : `<tr><td colspan="4" class="vazio">Nenhuma nota.</td></tr>`;
    rodape("t-notas", lista.length ? `<td colspan="3">Total</td><td class="num">${moeda.format(total)}</td>` : "");
    estado.notasVisiveis = lista;
  }

  function rodape(id, html) {
    const t = $(id);
    let f = t.querySelector("tfoot");
    if (!f) f = t.appendChild(document.createElement("tfoot"));
    f.innerHTML = html ? `<tr>${html}</tr>` : "";
  }

  const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  // ---------- CSV (separador ; e vírgula decimal, abre direto no Excel) ----------
  function baixarCsv(qual) {
    const v = estado.visao;
    if (!v) return;
    const n2 = (x) => String(round2(x)).replace(".", ",");
    let linhas;
    if (qual === "produtos") {
      const busca = norm($("prod-busca").value);
      linhas = [["Código", "Descrição", "Grupo", "Quantidade", "Unidade", "Valor"]].concat(
        ordenar(v.produtos.filter((p) => !busca || norm(`${p.codigo} ${p.descricao}`).includes(busca)), "produtos")
          .map((p) => [p.codigo, p.descricao, p.grupo, String(p.qtde).replace(".", ","), [...p.unidades.keys()].join("/"), n2(p.valor)]));
    } else {
      linhas = [["NF", "Emissão", "Origem", "Destino", "CFOP", "Valor"]].concat(
        (estado.notasVisiveis || []).map((n) => [n.nf, dataBR(n.data), n.origem, n.destino, n.cfop, n2(n.valor)]));
    }
    const csv = "﻿" + linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `transferencias_${qual}_${$("f-ano").value}-${String($("f-mes").value).padStart(2, "0")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ------------------------------------------------------------------
  // Eventos
  // ------------------------------------------------------------------
  function ligar() {
    $("f-mes").addEventListener("change", () => buscar());
    $("f-ano").addEventListener("change", () => buscar());
    $("f-loja").addEventListener("change", desenhar);
    $("f-grupo").addEventListener("change", desenhar);
    $("atualizar").addEventListener("click", () => buscar(true));
    $("prod-busca").addEventListener("input", () => estado.visao && desenharProdutos(estado.visao.produtos));
    $("nf-busca").addEventListener("input", () => estado.visao && desenharNotas(estado.visao.notas));
    document.querySelectorAll("[data-csv]").forEach((b) => b.addEventListener("click", () => baixarCsv(b.dataset.csv)));

    [["t-produtos", "produtos"], ["t-notas", "notas"]].forEach(([id, tabela]) => {
      $(id).querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
        const o = estado.ordem[tabela];
        if (o.campo === th.dataset.ord) o.asc = !o.asc;
        else { o.campo = th.dataset.ord; o.asc = !th.classList.contains("num") && th.dataset.ord !== "data"; }
        if (estado.visao) tabela === "produtos" ? desenharProdutos(estado.visao.produtos) : desenharNotas(estado.visao.notas);
      }));
    });

    $("tema").addEventListener("click", () => {
      const raiz = document.documentElement;
      const escuro = raiz.dataset.theme ? raiz.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      raiz.dataset.theme = escuro ? "light" : "dark";
      try { localStorage.setItem("tema", raiz.dataset.theme); } catch (e) { /* sem armazenamento: vale só nesta visita */ }
    });
  }

  montarFiltros();
  ligar();
  carregarLojas().then(() => buscar());
})();
