import { useState, useEffect, useRef } from 'react';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { getHistory, sendMessage } from './api';
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
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (logado) {
      getHistory()
        .then(data => setMessages(data.messages || []))
        .catch(() => setMessages([]));
    }
  }, [logado]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const enviar = async (texto) => {
    if (!texto.trim() || loading) return;

    setInput('');
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

  if (!logado) {
    return (
      <main className="login-page">
        <section className="login-hero">
          <Roseta className="roseta roseta-hero" />
          <p className="marca" translate="no">ChatPay</p>
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
      <div className="chat-container">
        <header className="header">
          <div className="brand-lockup">
            <span className="selo-marca" aria-hidden="true"><Roseta className="roseta" /></span>
            <div>
              <h1 translate="no">ChatPay</h1>
              <span className="status-label"><i aria-hidden="true" /> Agente online</span>
            </div>
          </div>
          <div className="header-actions">
            <span className="session-label">{user?.signInDetails?.loginId || 'Sessão protegida'}</span>
            <button type="button" className="logout-button" onClick={handleLogout}>Sair</button>
          </div>
        </header>

        <div className="messages" role="log" aria-live="polite" aria-busy={loading}>
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

          {messages.map((m, i) => (
            <div key={i} className={`message ${m.role}${m.erro ? ' erro' : ''}`}>
              <span className="sr-only">{m.role === 'user' ? 'Você disse:' : 'Agente:'}</span>
              <p>{formatMessage(m.content)}</p>
            </div>
          ))}

          {loading && (
            <div className="message assistant pensando">
              <span className="loading-indicator" aria-hidden="true"><i /><i /><i /></span>
              Consultando as ferramentas…
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <form className="input-area" onSubmit={handleSend}>
          <div className="compose-box">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
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
          <p className="input-note">Compras simuladas: nenhum valor é cobrado.</p>
        </form>
      </div>
    </main>
  );
}

export default App;
