"use client";

import { useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Group, Modal, Paper, ScrollArea, Stepper, Table, Text } from "@mantine/core";

function buildRangeLabel(summary, formatDateLabel) {
  if (!summary?.fromDate || !summary?.toDate) {
    return "Rango sincronizado no disponible";
  }

  return `${formatDateLabel(summary.fromDate)} a ${formatDateLabel(summary.toDate)}`;
}

export default function ExpenseImportModal({
  categories,
  error,
  fileName,
  formatDateLabel,
  onCategoryChange,
  onClose,
  onConfirmImport,
  onFileSelect,
  onReset,
  opened,
  rows,
  summary,
}) {
  const fileInputRef = useRef(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const stats = useMemo(() => {
    const duplicateCount = rows.filter((row) => row.isDuplicate).length;
    const importableCount = rows.length - duplicateCount;
    const categorizedImportCount = rows.filter((row) => !row.isDuplicate && row.category).length;
    const pendingCategoryCount = rows.filter((row) => !row.isDuplicate && !row.category).length;
    const suggestedCount = rows.filter((row) => !row.isDuplicate && row.suggestedCategory).length;
    const normalizedCount = rows.filter((row) => row.wasSanitized).length;

    return {
      categorizedImportCount,
      duplicateCount,
      importableCount,
      normalizedCount,
      pendingCategoryCount,
      suggestedCount,
    };
  }, [rows]);

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    await onFileSelect(file);
  };

  const handleDragEnter = (event) => {
    event.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();

    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    setIsDragActive(false);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    setIsDragActive(true);
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    setIsDragActive(false);
    const file = event.dataTransfer.files?.[0];

    if (!file) {
      return;
    }

    await onFileSelect(file);
  };

  const editableExistingCount = rows.filter(
    (row) => row.isDuplicate && row.category && String(row.category ?? "") !== String(row.existingCategory ?? ""),
  ).length;
  const canImport = Boolean(rows.length) && (stats.categorizedImportCount > 0 || editableExistingCount > 0);

  return (
    <Modal centered onClose={onClose} opened={opened} size="min(1520px, calc(100vw - 24px))" title="Importar gastos desde JSON">
      <div className="expense-import-modal">
        <Paper
          className={isDragActive ? "expense-import-dropzone active" : "expense-import-dropzone"}
          onClick={handleBrowseClick}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          p="lg"
          radius="lg"
          withBorder
        >
          <input accept=".json,application/json" hidden onChange={handleFileChange} ref={fileInputRef} type="file" />

          <Text fw={700}>Arrastra el JSON o cargalo desde la pestaña Gastos</Text>
          <Text c="dimmed" size="sm">
            {fileName ? `Archivo actual: ${fileName}` : "Formato esperado: export de cuenta Schwab con PostedTransactions."}
          </Text>

          <Group gap="sm" mt="md">
            <Button
              onClick={(event) => {
                event.stopPropagation();
                handleBrowseClick();
              }}
              variant="filled"
            >
              Seleccionar JSON
            </Button>
            {rows.length ? (
              <Button
                onClick={(event) => {
                  event.stopPropagation();
                  onReset();
                }}
                variant="default"
              >
                Limpiar wizard
              </Button>
            ) : null}
          </Group>
        </Paper>

        {error ? (
          <Alert className="expense-import-alert" color="red" radius="md" title="No se pudo leer el archivo" variant="light">
            {error}
          </Alert>
        ) : null}

        {rows.length ? (
          <Paper className="expense-import-summary" p="md" radius="lg" withBorder>
            <div className="expense-import-summary-copy">
              <Text fw={700} size="sm">
                Resumen del wizard
              </Text>
              <Text c="dimmed" size="sm">
                Puedes importar por tandas. Las nuevas solo entran si tienen categoria, y las ya importadas se pueden recategorizar desde aqui.
              </Text>
            </div>

            <Group gap="xs">
              <Badge color="teal" radius="sm" variant="light">
                {stats.categorizedImportCount} listos para importar
              </Badge>
              <Badge color={stats.pendingCategoryCount ? "orange" : "gray"} radius="sm" variant="light">
                {stats.pendingCategoryCount} sin categoria
              </Badge>
              <Badge color={stats.duplicateCount ? "red" : "gray"} radius="sm" variant="light">
                {stats.duplicateCount} duplicados
              </Badge>
              <Badge color={editableExistingCount ? "violet" : "gray"} radius="sm" variant="light">
                {editableExistingCount} cambios sobre existentes
              </Badge>
              <Badge color={stats.normalizedCount ? "blue" : "gray"} radius="sm" variant="light">
                {stats.normalizedCount} normalizados
              </Badge>
              <Badge color={stats.suggestedCount ? "cyan" : "gray"} radius="sm" variant="light">
                {stats.suggestedCount} con sugerencia
              </Badge>
              <Badge color="gray" radius="sm" variant="light">
                {buildRangeLabel(summary, formatDateLabel)}
              </Badge>
            </Group>
          </Paper>
        ) : null}

        {rows.length ? (
          <ScrollArea className="expense-import-table-wrap" offsetScrollbars scrollbarSize={10}>
            <Table className="expense-import-table" striped withColumnBorders withRowBorders withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Fecha</Table.Th>
                  <Table.Th>Descripcion</Table.Th>
                  <Table.Th>Monto</Table.Th>
                  <Table.Th>Categoria</Table.Th>
                  <Table.Th>Duplicado</Table.Th>
                </Table.Tr>
              </Table.Thead>

              <Table.Tbody>
                {rows.map((row) => (
                  <Table.Tr className={row.isDuplicate ? "expense-import-row duplicate" : "expense-import-row"} key={row.id}>
                    <Table.Td>{formatDateLabel(row.movementDate)}</Table.Td>
                    <Table.Td>
                      <div className="expense-import-description">
                        <Text fw={600} size="sm">
                          {row.name}
                        </Text>
                        {row.wasSanitized ? (
                          <Text c="dimmed" size="xs">
                            Original: {row.rawDescription}
                          </Text>
                        ) : null}
                      </div>
                    </Table.Td>
                    <Table.Td>
                      <Text fw={700} size="sm">
                        US${row.amount.toFixed(2)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <div className="expense-import-category-cell">
                        <select onChange={(event) => onCategoryChange(row.id, event.target.value)} value={row.category}>
                          <option value="">Seleccionar</option>
                          {categories.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                        {row.suggestedCategory ? (
                          <Badge color="cyan" radius="sm" size="xs" variant="light">
                            Sugerida: {row.suggestedCategory}
                          </Badge>
                        ) : null}
                        {row.isDuplicate ? (
                          <Badge color="violet" radius="sm" size="xs" variant="light">
                            Actual: {row.existingCategory || "Sin categoria"}
                          </Badge>
                        ) : null}
                      </div>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={row.isDuplicate ? "violet" : "teal"} radius="sm" variant="light">
                        {row.isDuplicate ? "Ya existe" : "Nuevo"}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        ) : null}

        <Group justify="space-between">
          <Text c="dimmed" size="sm">
            Si un movimiento ya existe, puedes cambiarle la categoria aqui mismo. Las filas nuevas sin categoria no se agregan para que puedas seguir en otra tanda.
          </Text>
          <Group gap="sm">
            <Button onClick={onClose} variant="default">
              Cerrar
            </Button>
            <Button disabled={!canImport} onClick={onConfirmImport}>
              Importar gastos
            </Button>
          </Group>
        </Group>
      </div>
    </Modal>
  );
}
