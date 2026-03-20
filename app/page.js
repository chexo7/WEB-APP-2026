"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";

const defaultCredentials = {
  email: "ssfamiliausa@gmail.com",
  password: "",
};

export default function HomePage() {
  const [credentials, setCredentials] = useState(defaultCredentials);
  const [authState, setAuthState] = useState("checking");
  const [authError, setAuthError] = useState("");
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    const auth = getFirebaseAuth();

    return onAuthStateChanged(auth, (user) => {
      setAuthState(user ? "authenticated" : "anonymous");
      setUserEmail(user?.email ?? "");
    });
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setCredentials((current) => ({ ...current, [name]: value }));
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setAuthError("");
    setAuthState("loading");

    try {
      const auth = getFirebaseAuth();
      await signInWithEmailAndPassword(auth, credentials.email.trim(), credentials.password);
    } catch (firebaseError) {
      setAuthState("anonymous");
      setAuthError(firebaseError.message);
    }
  };

  const handleLogout = async () => {
    setAuthError("");

    try {
      const auth = getFirebaseAuth();
      await signOut(auth);
    } catch (firebaseError) {
      setAuthError(firebaseError.message);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-card">
        {authState === "authenticated" ? (
          <div className="logged-panel">
            <h1>Sesion iniciada</h1>
            <p>{userEmail}</p>
            <button className="primary-button" onClick={handleLogout} type="button">
              Cerrar sesion
            </button>
          </div>
        ) : (
          <form className="login-form" onSubmit={handleLogin}>
            <h1>Acceso</h1>

            <label>
              Usuario
              <input
                autoComplete="email"
                name="email"
                onChange={handleChange}
                type="email"
                value={credentials.email}
              />
            </label>

            <label>
              Contrasena
              <input
                autoComplete="current-password"
                name="password"
                onChange={handleChange}
                type="password"
                value={credentials.password}
              />
            </label>

            <button className="primary-button" disabled={authState === "loading"} type="submit">
              {authState === "loading" ? "Entrando..." : "Entrar"}
            </button>

            {authError ? <p className="error-text">{authError}</p> : null}
          </form>
        )}
      </section>
    </main>
  );
}
