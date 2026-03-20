"use client";

import { useEffect, useState } from "react";
import { onValue, push, ref, serverTimestamp, set } from "firebase/database";
import { database } from "@/lib/firebase";

const recordsRef = ref(database, "registros");

export default function HomePage() {
  const [records, setRecords] = useState([]);
  const [form, setForm] = useState({ nombre: "", mensaje: "" });
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribe = onValue(
      recordsRef,
      (snapshot) => {
        const data = snapshot.val() ?? {};
        const nextRecords = Object.entries(data)
          .map(([id, value]) => ({ id, ...value }))
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

        setRecords(nextRecords);
      },
      (firebaseError) => {
        setError(firebaseError.message);
      },
    );

    return () => unsubscribe();
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus("saving");
    setError("");

    try {
      const newRecordRef = push(recordsRef);

      await set(newRecordRef, {
        nombre: form.nombre.trim(),
        mensaje: form.mensaje.trim(),
        createdAt: Date.now(),
        createdAtServer: serverTimestamp(),
      });

      setForm({ nombre: "", mensaje: "" });
      setStatus("saved");
    } catch (firebaseError) {
      setStatus("error");
      setError(firebaseError.message);
    }
  };

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <span className="eyebrow">Next.js + Firebase Realtime Database</span>
          <h1>Tu web ya esta lista para leer y guardar datos en tiempo real.</h1>
          <p>
            Este panel escucha la ruta <code>/registros</code> de tu base de datos y
            agrega nuevas entradas al instante.
          </p>
        </div>

        <form className="entry-form" onSubmit={handleSubmit}>
          <label>
            Nombre
            <input
              name="nombre"
              onChange={handleChange}
              placeholder="Tu nombre"
              required
              value={form.nombre}
            />
          </label>

          <label>
            Mensaje
            <textarea
              name="mensaje"
              onChange={handleChange}
              placeholder="Escribe algo para guardar en Firebase"
              required
              rows={4}
              value={form.mensaje}
            />
          </label>

          <button disabled={status === "saving"} type="submit">
            {status === "saving" ? "Guardando..." : "Guardar en Firebase"}
          </button>

          {status === "saved" ? <p className="success">Registro guardado correctamente.</p> : null}
          {error ? <p className="error">Error: {error}</p> : null}
        </form>
      </section>

      <section className="list-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Datos en vivo</span>
            <h2>Registros almacenados</h2>
          </div>
          <span className="record-count">{records.length} elementos</span>
        </div>

        <div className="records-grid">
          {records.length ? (
            records.map((record) => (
              <article className="record-item" key={record.id}>
                <div className="record-header">
                  <strong>{record.nombre}</strong>
                  <span>{formatDate(record.createdAt)}</span>
                </div>
                <p>{record.mensaje}</p>
              </article>
            ))
          ) : (
            <article className="record-item empty-state">
              <strong>No hay registros todavia.</strong>
              <p>Crea el primero desde el formulario para probar la conexion.</p>
            </article>
          )}
        </div>
      </section>
    </main>
  );
}

function formatDate(timestamp) {
  if (!timestamp) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}
