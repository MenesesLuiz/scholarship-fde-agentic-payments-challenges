import { useState, useEffect, useRef } from 'react';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { getHistory, sendMessage } from './api';
import { LOGO_TRACOS, LOGO_VIEWBOX } from './logo';
import './App.css';

// Hipotrocoide: a curva das linhas de segurança (guilhochê) das cédulas.
// R=60 e r=22 fecham a curva em 11 voltas; cada camada muda só a distância d.
const ROSETA = [30, 24, 17].map((d) => {
  const R = 60, r = 22, passos = 1400, fim = 22 * Math.PI;
  let caminho = '';
  for (let i = 0; i <= passos; i++) {
    const t = (fim * i) / passos;
    const x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
    const y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
    caminho += `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return caminho;
});

function Roseta({ className }) {
  return (
    <svg className={className} viewBox="-70 -70 140 140" aria-hidden="true" focusable="false">
      {ROSETA.map((d, i) => (
        <path key={i} d={d} pathLength="1" />
      ))}
    </svg>
  );
}

// Logo manuscrita: o mesmo traço de caneta da roseta, escrito uma vez ao aparecer.
// Um <path> por traço, cada um começando quando o anterior termina: num path só,
// o navegador reinicia o tracejado em cada traço e todas as letras surgiriam juntas.
const ESCRITA_S = 2.4;
function Logo({ className }) {
  return (
    <svg className={`logo ${className}`} viewBox={LOGO_VIEWBOX} aria-hidden="true" focusable="false">
      {LOGO_TRACOS.map(([d, inicio, duracao], i) => (
        <path
          key={i}
          d={d}
          pathLength="1"
          style={{ animationDelay: `${0.2 + inicio * ESCRITA_S}s`, animationDuration: `${duracao * ESCRITA_S}s` }}
        />
      ))}
    </svg>
  );
}

// Destaca valores em reais (R$ 249,90) dentro do texto do agente.
const VALOR = /(R\$\s?\d[\d.]*(?:,\d{2})?)/;
const destacarValores = (texto) =>
  texto.split(VALOR).map((parte, i) => (i % 2 ? <strong key={i} className="valor">{parte}</strong> : parte));

const PASSOS = [
  ['Catálogo', 'Peça para ver os produtos e os preços.'],
  ['Intenção', 'O agente registra o produto, o valor e a forma de pagamento.'],
  ['Pagamento', 'Só acontece depois que você confirma Pix ou cartão.'],
];

const SUGESTOES = [
  'Ver o catálogo',
  'Quero comprar um fone com Pix',
  'Comprar o notebook no cartão',
];

function App() {
  const { authStatus, user, signOut } = useAuthenticator((ctx) => [ctx.authStatus, ctx.user]);
  const logado = authStatus === 'authenticated';
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listaRef = useRef(null);
  const turnoRef = useRef(null);
  const campoRef = useRef(null);
  // Rolagem pedida para o próximo render: 'fim' ao abrir o histórico, 'turno' ao enviar.
  // Durante o streaming fica null, para a tela não descer a cada pedaço da resposta.
  const rolagem = useRef(null);

  useEffect(() => {
    if (logado) {
      getHistory()
        .then(data => { rolagem.current = 'fim'; setMessages(data.messages || []); })
        .catch(() => setMessages([]));
    }
  }, [logado]);

  useEffect(() => {
    const lista = listaRef.current;
    if (!lista || !rolagem.current) return;
    if (rolagem.current === 'fim') {
      lista.scrollTop = lista.scrollHeight;
    } else if (turnoRef.current) {
      const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      lista.scrollTo({ top: turnoRef.current.offsetTop - 16, behavior: suave ? 'smooth' : 'auto' });
    }
    rolagem.current = null;
  }, [messages]);

  // A pergunta mais recente e o que veio depois dela formam o turno atual,
  // que ocupa ao menos a altura da tela para a pergunta poder ficar no topo.
  const inicioTurno = messages.findLastIndex(m => m.role === 'user');
  const anteriores = inicioTurno < 0 ? messages : messages.slice(0, inicioTurno);
  const turno = inicioTurno < 0 ? [] : messages.slice(inicioTurno);

  const enviar = async (texto) => {
    if (!texto.trim() || loading) return;

    setInput('');
    if (campoRef.current) campoRef.current.style.height = '';
    rolagem.current = 'turno';
    setMessages(prev => [...prev, { role: 'user', content: texto }]);
    setLoading(true);

    try {
      // A resposta chega aos poucos: cria a bolha do agente e vai completando o texto.
      let primeiro = true;
      await sendMessage(texto, (pedaco) => {
        if (primeiro) {
          primeiro = false;
          setLoading(false);
          setMessages(prev => [...prev, { role: 'assistant', content: pedaco }]);
        } else {
          setMessages(prev => {
            const copia = [...prev];
            const ultima = copia[copia.length - 1];
            copia[copia.length - 1] = { ...ultima, content: ultima.content + pedaco };
            return copia;
          });
        }
      });
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', erro: true, content: error.message || 'Não foi possível falar com o assistente. Tente de novo.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = (e) => {
    e.preventDefault();
    enviar(input);
  };

  // Enter envia; Shift+Enter quebra a linha (e não envia no meio de uma composição do teclado).
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      enviar(input);
    }
  };

  // O campo cresce com o texto até 160px; depois disso rola por dentro.
  const handleInput = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  const handleLogout = () => {
    setMessages([]);
    signOut();
  };

  // Exibe respostas do modelo como texto simples, sem marcas de Markdown.
  const formatMessage = (text) => {
    if (!text) return "";
    return text
      .replace(/&#x20;|&#32;|&nbsp;/gi, ' ')
      .replace(/\\([_*`])/g, '$1')
      .replace(/\*\*/g, '')
      .replace(/`/g, '');
  };

  const mensagem = (m, i) => (
    <div key={i} className={`message ${m.role}${m.erro ? ' erro' : ''}`}>
      <span className="sr-only">{m.role === 'user' ? 'Você disse:' : 'Agente:'}</span>
      <p>{m.role === 'assistant' && !m.erro ? destacarValores(formatMessage(m.content)) : formatMessage(m.content)}</p>
    </div>
  );

  if (!logado) {
    return (
      <main className="login-page">
        <section className="login-hero">
          <Roseta className="roseta roseta-hero" />
          <p className="marca" translate="no">
            <Logo className="logo-login" />
            <span className="sr-only">ChatPay</span>
          </p>
          <h1>Compras pelo chat, pagas com Pix ou cartão.</h1>
          <p className="login-copy">
            O agente mostra o catálogo, registra o que você quer e só paga depois da sua confirmação.
          </p>
        </section>

        <section className="login-form" aria-labelledby="titulo-login">
          <div className="login-form-inner">
            <h2 id="titulo-login">Entrar</h2>
            {/* Login do Cognito; sem opção de cadastro: usuários só entram por convite. */}
            <Authenticator
              hideSignUp
              formFields={{ signIn: { username: { label: "E-mail", placeholder: "voce@empresa.com" } } }}
            />
            <p className="login-note">Acesso somente por convite do administrador.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="chat-page">
      <h1 className="sr-only" translate="no">ChatPay</h1>

      {/* Coluna lateral: só no desktop. */}
      <aside className="painel" aria-label="Sobre o ChatPay">
        <Roseta className="roseta roseta-painel" />
        <Logo className="logo-painel" />
        <p className="status-label"><i aria-hidden="true" /> Agente online</p>

        <section className="como-funciona" aria-labelledby="titulo-passos">
          <h2 id="titulo-passos">Como funciona</h2>
          <ol className="passos">
            {PASSOS.map(([titulo, texto]) => (
              <li key={titulo}>
                <strong>{titulo}</strong>
                <span>{texto}</span>
              </li>
            ))}
          </ol>
        </section>

        <div className="painel-rodape">
          <p className="aviso">Limite de R$&nbsp;2.000 por padrão no primeiro uso. Compras simuladas: nenhum valor é cobrado.</p>
          <div className="sessao">
            <span className="session-label">{user?.signInDetails?.loginId || 'Sessão protegida'}</span>
            <button type="button" className="logout-button" onClick={handleLogout}>Sair</button>
          </div>
        </div>
      </aside>

      <section className="conversa" aria-label="Conversa com o agente">
        {/* Cabeçalho fino: só no celular. */}
        <header className="header">
          <Logo className="logo-header" />
          <button type="button" className="logout-button" onClick={handleLogout}>Sair</button>
        </header>

        <div className="messages" ref={listaRef} role="log" aria-live="polite" aria-busy={loading}>
          {messages.length === 0 && (
            <div className="empty-state">
              <Roseta className="roseta roseta-vazio" />
              <h2>O que você quer comprar hoje?</h2>
              <p>Comece pelo catálogo ou peça um produto direto. Nenhuma compra é feita sem a sua confirmação.</p>
              <ul className="sugestoes">
                {SUGESTOES.map((s) => (
                  <li key={s}>
                    <button type="button" onClick={() => enviar(s)} disabled={loading}>{s}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {anteriores.map(mensagem)}

          {turno.length > 0 && (
            <div className="turno-atual" ref={turnoRef}>
              {turno.map(mensagem)}
              {loading && (
                <div className="message assistant pensando">
                  <span className="loading-indicator" aria-hidden="true"><i /><i /><i /></span>
                  Consultando as ferramentas…
                </div>
              )}
            </div>
          )}
        </div>

        <form className="input-area" onSubmit={handleSend}>
          <div className="compose-box">
            <textarea
              ref={campoRef}
              rows={1}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Escreva uma mensagem…"
              aria-label="Mensagem para o assistente"
              autoComplete="off"
              enterKeyHint="send"
              disabled={loading}
            />
            <button className="send-button" type="submit" disabled={loading || !input.trim()} aria-label="Enviar mensagem">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
          <p className="input-note">Enter envia, Shift+Enter quebra a linha. Compras simuladas.</p>
        </form>
      </section>
    </main>
  );
}

export default App;
