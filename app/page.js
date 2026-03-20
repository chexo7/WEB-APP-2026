"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { onValue, ref, set } from "firebase/database";
import { auth, database } from "@/lib/firebase";

const connectionRef = ref(database, ".info/connected");
const landingRef = ref(database, "landing");

const defaultCredentials = {
  email: "ssfamiliausa@gmail.com",
  password: "",
};

const defaultContent = {
  title: "Firebase conectado",
  description: "Una landing minima para comprobar autenticacion, conexion y lectura/escritura en tiempo real.",
  statusLabel: "Esperando conexion",
  updatedAt: null,
};

export default function HomePage() {
  const [credentials, setCredentials] = useState(defaultCredentials);
  const [authState, setAuthState] = useState("checking");
  const [connectionState, setConnectionState] = useState("checking");
  const [submitState, setSubmitState] = useState("idle");
  const [authError, setAuthError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [content, setContent] = useState(defaultContent);
  const [draft, setDraft] = useState(defaultContent);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setAuthState(user ? "authenticated" : "anonymous");
      setUserEmail(user?.email ?? "");
    });

    const unsubscribeConnection = onValue(connectionRef, (snapshot) => {
      setConnectionState(snapshot.val() ? "online" : "offline");
    });

    const unsubscribeContent = onValue(
      landingRef,
      (snapshot) => {
        const data = snapshot.val();
        const nextContent = data ? { ...defaultContent, ...data } : defaultContent;

        setContent(nextContent);
        setDraft(nextContent);
      },
      (firebaseError) => {
        setSaveError(firebaseError.message);
      },
    );

    return () => {
      unsubscribeAuth();
      unsubscribeConnection();
      unsubscribeContent();
    };
  }, []);

  const handleCredentialsChange = (event) => {
    const { name, value } = event.target;
    setCredentials((current) => ({ ...current, [name]: value }));
  };

  const handleDraftChange = (event) => {
    const { name, value } = event.target;
    setDraft((current) => ({ ...current, [name]: value }));
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setAuthError("");
    setAuthState("loading");

    try {
      await signInWithEmailAndPassword(auth, credentials.email.trim(), credentials.password);
    } catch (firebaseError) {
      setAuthState("anonymous");
      setAuthError(firebaseError.message);
    }
  };

  const handleLogout = async () => {
    setAuthError("");

    try {
      await signOut(auth);
    } catch (firebaseError) {
      setAuthError(firebaseError.message);
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setSubmitState("saving");
    setSaveError("");

    try {
      const nextContent = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        statusLabel: draft.statusLabel.trim(),
        updatedAt: Date.now(),
        updatedBy: userEmail || credentials.email.trim(),
      };

      await set(landingRef, nextContent);
      setSubmitState("saved");
    } catch (firebaseError) {
      setSubmitState("error");
      setSaveError(firebaseError.message);
    }
  };

  return (
    <main className="page-shell">
      <section className="hero-card landing-hero">
        <div className="hero-copy">
          <span className="eyebrow">Firebase status landing</span>
          <h1>Conexion, autenticacion y base de datos en una sola vista.</h1>
          <p>
            Esta landing lee la ruta <code>/landing</code>, muestra el estado de Firebase y
            permite editar el contenido cuando hay una sesion activa.
          </p>

          <div className="status-strip">
            <StatusPill
              label="Base de datos"
              tone={connectionState === "online" ? "success" : connectionState === "offline" ? "danger" : "neutral"}
              value={
                connectionState === "online"
                  ? "Conectada"
                  : connectionState === "offline"
                    ? "Sin conexion"
                    : "Verificando"
              }
            />
            <StatusPill
              label="Sesion"
              tone={authState === "authenticated" ? "success" : authState === "loading" ? "neutral" : "danger"}
              value={
                authState === "authenticated"
                  ? "Activa"
                  : authState === "loading"
                    ? "Ingresando"
                    : authState === "checking"
                      ? "Comprobando"
                      : "Cerrada"
              }
            />
          </div>
        </div>

        <form className="entry-form auth-form" onSubmit={handleLogin}>
          <div className="card-heading">
            <h2>Acceso</h2>
            <p>El correo queda por defecto. La contrasena no se deja embebida en la web por seguridad.</p>
          </div>

          <label>
            Email
            <input
              autoComplete="email"
              name="email"
              onChange={handleCredentialsChange}
              type="email"
              value={credentials.email}
            />
          </label>

          <label>
            Password
            <input
              autoComplete="current-password"
              name="password"
              onChange={handleCredentialsChange}
              placeholder="Ingresa tu password"
              type="password"
              value={credentials.password}
            />
          </label>

          <button disabled={authState === "loading"} type="submit">
            {authState === "loading" ? "Conectando..." : "Iniciar sesion"}
          </button>

          <div className="session-summary">
            <span>{userEmail || "Sin sesion activa"}</span>
            <button
              className="secondary-button"
              onClick={handleLogout}
              type="button"
            >
              Cerrar sesion
            </button>
          </div>

          {authError ? <p className="error">Error: {authError}</p> : null}
        </form>
      </section>

      <section className="list-card dashboard-grid">
        <article className="preview-card">
          <span className="eyebrow">Vista actual</span>
          <h2>{content.title}</h2>
          <p>{content.description}</p>

          <div className="status-panel">
            <div>
              <span className="meta-label">Estado visible</span>
              <strong>{content.statusLabel}</strong>
            </div>
            <div>
              <span className="meta-label">Ultima actualizacion</span>
              <strong>{formatDate(content.updatedAt)}</strong>
            </div>
          </div>
        </article>

        <form className="entry-form editor-card" onSubmit={handleSave}>
          <div className="card-heading">
            <h2>Editor</h2>
            <p>Modifica el contenido guardado en Firebase Realtime Database.</p>
          </div>

          <label>
            Titulo
            <input
              disabled={authState !== "authenticated"}
              name="title"
              onChange={handleDraftChange}
              value={draft.title}
            />
          </label>

          <label>
            Descripcion
            <textarea
              disabled={authState !== "authenticated"}
              name="description"
              onChange={handleDraftChange}
              rows={5}
              value={draft.description}
            />
          </label>

          <label>
            Etiqueta de estado
            <input
              disabled={authState !== "authenticated"}
              name="statusLabel"
              onChange={handleDraftChange}
              value={draft.statusLabel}
            />
          </label>

          <button disabled={authState !== "authenticated" || submitState === "saving"} type="submit">
            {submitState === "saving" ? "Guardando..." : "Guardar cambios"}
          </button>

          {submitState === "saved" ? <p className="success">Cambios guardados correctamente.</p> : null}
          {saveError ? <p className="error">Error: {saveError}</p> : null}
        </form>
      </section>
    </main>
  );
}

function StatusPill({ label, value, tone }) {
  return (
    <div className={`status-pill status-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(timestamp) {
  if (!timestamp) {
    return "Todavia sin cambios";
  }

  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}
