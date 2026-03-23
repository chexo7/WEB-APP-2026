"use client";

import { Badge, Button, Group, Modal, Paper, Text } from "@mantine/core";

function buildOccurrenceOptionLabel(item, formatDateLabel) {
  if (!item) {
    return "Selecciona un pago";
  }

  if (item.isAdjusted) {
    return `Programado ${formatDateLabel(item.originalDate)} -> Paga ${formatDateLabel(item.date)}`;
  }

  return `Programado ${formatDateLabel(item.originalDate)}`;
}

export default function IncomeScheduleModal({
  adjustedDate,
  formatDateLabel,
  income,
  occurrenceOptions,
  onAdjustedDateChange,
  onClose,
  onOccurrenceChange,
  onSave,
  onSelectOverride,
  onToggleOverride,
  opened,
  overrideRecords,
  selectedOccurrence,
  selectedOccurrenceDate,
}) {
  return (
    <Modal centered onClose={onClose} opened={opened} size="lg" title="Ajuste puntual de pago">
      <div className="income-schedule-modal">
        <Paper className="income-schedule-hero" p="md" radius="lg" withBorder>
          <div>
            <Text fw={700} size="lg">
              {income?.name || "Ingreso"}
            </Text>
            <Text c="dimmed" size="sm">
              La regla base del ingreso se mantiene. Aqui solo ajustas pagos puntuales y puedes desactivarlos cuando quieras.
            </Text>
          </div>

          <Group gap="xs">
            <Badge color="blue" radius="sm" variant="light">
              {income?.frequency || "Unico"}
            </Badge>
            <Badge color="gray" radius="sm" variant="light">
              Inicio {formatDateLabel(income?.startDate)}
            </Badge>
          </Group>
        </Paper>

        <label className="income-schedule-field">
          Pago programado
          <select onChange={(event) => onOccurrenceChange(event.target.value)} value={selectedOccurrenceDate}>
            {occurrenceOptions.length ? null : <option value="">No hay pagos disponibles en la ventana actual</option>}
            {occurrenceOptions.map((item) => (
              <option key={item.originalDate} value={item.originalDate}>
                {buildOccurrenceOptionLabel(item, formatDateLabel)}
              </option>
            ))}
          </select>
        </label>

        <label className="income-schedule-field">
          Nueva fecha de pago
          <input onChange={(event) => onAdjustedDateChange(event.target.value)} type="date" value={adjustedDate} />
        </label>

        <Paper className="income-schedule-preview" p="md" radius="lg" withBorder>
          <Text fw={700} size="sm">
            Vista previa del ajuste
          </Text>
          <Text c="dimmed" size="sm">
            Programado: {selectedOccurrence ? formatDateLabel(selectedOccurrence.originalDate) : "Sin seleccion"}
          </Text>
          <Text c="dimmed" size="sm">
            Fecha final aplicada: {adjustedDate ? formatDateLabel(adjustedDate) : "Sin cambio"}
          </Text>
          {selectedOccurrence?.isAdjusted ? (
            <Badge color="orange" mt="xs" radius="sm" variant="light">
              Este pago ya tiene un ajuste activo
            </Badge>
          ) : null}
        </Paper>

        <Group justify="space-between">
          <Text c="dimmed" size="sm">
            Si desactivas un ajuste, el calendario vuelve automaticamente al orden normal.
          </Text>
          <Group gap="sm">
            <Button onClick={onClose} variant="default">
              Cerrar
            </Button>
            <Button disabled={!selectedOccurrenceDate || !adjustedDate} onClick={onSave}>
              Guardar ajuste
            </Button>
          </Group>
        </Group>

        <div className="income-schedule-records">
          <Text fw={700} size="sm">
            Ajustes registrados
          </Text>

          {overrideRecords.length ? (
            <div className="income-schedule-record-list">
              {overrideRecords.map((record) => (
                <Paper className="income-schedule-record" key={record.originalDate} p="md" radius="lg" withBorder>
                  <div className="income-schedule-record-copy">
                    <Text fw={700} size="sm">
                      {`${formatDateLabel(record.originalDate)} -> ${formatDateLabel(record.adjustedDate)}`}
                    </Text>
                    <Text c="dimmed" size="sm">
                      {record.isActive ? "Ajuste activo" : "Ajuste desactivado"}
                    </Text>
                  </div>

                  <Group gap="xs">
                    <Badge color={record.isActive ? "orange" : "gray"} radius="sm" variant="light">
                      {record.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                    <Button onClick={() => onSelectOverride(record.originalDate)} size="xs" variant="default">
                      Ver
                    </Button>
                    <Button
                      color={record.isActive ? "orange" : "teal"}
                      onClick={() => onToggleOverride(record.originalDate)}
                      size="xs"
                      variant="light"
                    >
                      {record.isActive ? "Desactivar" : "Reactivar"}
                    </Button>
                  </Group>
                </Paper>
              ))}
            </div>
          ) : (
            <Text c="dimmed" size="sm">
              Todavia no hay ajustes puntuales para este ingreso.
            </Text>
          )}
        </div>
      </div>
    </Modal>
  );
}
