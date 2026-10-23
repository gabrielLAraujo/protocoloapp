import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { planVersionSync } from "../../data/planRepo";
import { scheduleRepo } from "../../data/scheduleRepo";
import { USER_A } from "../../test/localDb";
import { mockFetch } from "../../test/fetch-mock";
import { setupApp } from "../testSupport";
import { ACTIVE_ID, protocolDocument } from "./fixtures";
import { ProtocolView } from "./ProtocolView";

describe("ProtocolView", () => {
  it("shows the active protocol read-only from the device", async () => {
    mockFetch({});
    const { db, view } = await setupApp();
    await planVersionSync.applyRemote(db, {
      entity: "plan_version",
      id: ACTIVE_ID,
      version: 1,
      payload: {
        kind: "protocol",
        status: "active",
        document: protocolDocument(),
        activated_at: "2026-10-10T15:00:00.000Z",
        low_confidence: [],
      },
      deletedAt: null,
      clientUpdatedAt: "2026-10-10T12:00:00.000000+00:00",
    });
    view(<ProtocolView />);

    expect(
      await screen.findByRole("heading", { name: "Fase 2" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Atualização em 20\/11/)).toBeInTheDocument();
    expect(screen.getByText("Café da manhã")).toBeInTheDocument();
    expect(screen.getByText("120 g")).toBeInTheDocument();
    expect(screen.getByText(/Creatina/)).toBeInTheDocument();
    expect(screen.getByText("Suplemento")).toBeInTheDocument();
    expect(screen.getByText("Todos os dias")).toBeInTheDocument();
    expect(screen.getByText("3x por semana")).toBeInTheDocument();
    expect(screen.getByText("30 min")).toBeInTheDocument();
    expect(screen.getByText("Água: no mínimo 3 L por dia")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("without an active protocol points to Planejamento", async () => {
    mockFetch({});
    const { view } = await setupApp();
    view(<ProtocolView />);

    expect(
      await screen.findByText(
        "Nenhum protocolo ativo. Envie o PDF em Planejamento.",
      ),
    ).toBeInTheDocument();
  });

  it("lays out meals, grouped items, cardio and guidelines", async () => {
    mockFetch({});
    const { db, view } = await setupApp();
    const doc = {
      ...protocolDocument(),
      meals: [
        {
          key: "m1",
          label: "Refeição teste",
          notes: "Pesar cru",
          items: [
            { food: "Arroz", grams: 150, alternatives: [] },
            { food: "Folhas verdes", alternatives: [] },
          ],
        },
      ],
      items: [
        {
          key: "a",
          category: "supplement",
          name: "Item noite",
          doseText: "1 cápsula",
          timing: "before_bed",
          schedule: { type: "daily" },
        },
        {
          key: "b",
          category: "compound",
          name: "Item sem horário conhecido",
          timing: "xyz",
          schedule: { type: "training_days_only" },
        },
        {
          key: "c",
          category: "supplement",
          name: "Item jejum",
          timing: "fasting",
          schedule: { type: "daily" },
        },
        {
          key: "d",
          category: "supplement",
          name: "Item pós",
          doseText: "2 g",
          timing: "post_workout",
          schedule: { type: "daily" },
        },
        {
          key: "e",
          category: "supplement",
          name: "Item com refeição",
          timing: "with_meal:m1",
          schedule: { type: "daily" },
        },
        {
          key: "f",
          category: "supplement",
          name: "Item refeição sumida",
          timing: "with_meal:m9",
          schedule: { type: "training_days_only" },
        },
      ],
      cardio: { daily: true, durationMin: 20, intensity: "leve" },
      guidelines: [{ kind: "text", text: "Dormir bem" }],
    };
    await planVersionSync.applyRemote(db, {
      entity: "plan_version",
      id: ACTIVE_ID,
      version: 1,
      payload: {
        kind: "protocol",
        status: "active",
        document: doc,
        activated_at: "2026-10-10T15:00:00.000Z",
        low_confidence: [],
      },
      deletedAt: null,
      clientUpdatedAt: "2026-10-10T12:00:00.000000+00:00",
    });
    view(<ProtocolView />);

    const table = await screen.findByRole("table", {
      name: "Alimentos: Refeição teste",
    });
    const grams = within(table).getByText("150 g");
    expect(grams).toHaveClass("text-right", "tabular-nums");
    const rice = within(table).getByRole("row", { name: /Arroz/ });
    expect(within(rice).getAllByRole("cell")).toHaveLength(1);
    const greens = within(table).getByRole("row", { name: /Folhas verdes/ });
    expect(within(greens).getByRole("cell")).toBeEmptyDOMElement();
    expect(screen.getByText("Pesar cru")).toBeInTheDocument();

    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(headings.slice(1)).toEqual([
      "Em jejum",
      "Com refeições",
      "Pós-treino",
      "Antes de dormir",
      "Outros",
    ]);
    // With a meal: which one, by its label (its key when the protocol has no such meal).
    const withMeals = within(
      screen.getByRole("region", { name: "Com refeições" }),
    );
    expect(
      withMeals.getByText("Com Refeição teste · Todos os dias"),
    ).toBeInTheDocument();
    expect(
      withMeals.getByText("Com m9 · Só em dias de treino"),
    ).toBeInTheDocument();
    const other = screen.getByRole("region", { name: "Outros" });
    expect(
      within(other).getByText("Item sem horário conhecido"),
    ).toBeInTheDocument();
    expect(within(other).getByText("Só em dias de treino")).toBeInTheDocument();
    expect(within(other).queryByText(/cápsula/)).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Antes de dormir" })).getByText(
        "1 cápsula",
      ),
    ).toBeInTheDocument();

    expect(
      screen.getByText("Todos os dias", { selector: "li" }),
    ).toBeInTheDocument();
    expect(screen.getByText("20 min")).toBeInTheDocument();
    expect(screen.getByText("Dormir bem")).toBeInTheDocument();
  });

  async function activate(
    db: Awaited<ReturnType<typeof setupApp>>["db"],
    meals: unknown[],
  ) {
    await planVersionSync.applyRemote(db, {
      entity: "plan_version",
      id: ACTIVE_ID,
      version: 1,
      payload: {
        kind: "protocol",
        status: "active",
        document: { ...protocolDocument(), meals },
        activated_at: "2026-10-10T15:00:00.000Z",
        low_confidence: [],
      },
      deletedAt: null,
      clientUpdatedAt: "2026-10-10T12:00:00.000000+00:00",
    });
  }
  const mealDoc = (key: string, label: string) => ({ key, label, items: [] });
  const setTime = (
    db: Awaited<ReturnType<typeof setupApp>>["db"],
    key: string,
    time: string,
  ) =>
    scheduleRepo.set(
      db,
      USER_A,
      `meal_${key}`,
      "off",
      { time, reminderEnabled: false },
      new Date(),
    );

  it("shows the configured time next to the meal name and orders meals by time", async () => {
    mockFetch({});
    const { db, view } = await setupApp();
    await activate(db, [
      mealDoc("m1", "Jantar"),
      mealDoc("m2", "Café"),
      mealDoc("m3", "Almoço"),
    ]);
    await setTime(db, "m1", "19:30");
    await setTime(db, "m2", "07:00");
    await setTime(db, "m3", "12:15");
    view(<ProtocolView />);

    const time = await screen.findByText("07:00");
    expect(time).toHaveClass("tabular-nums", "text-muted");
    expect(screen.getByText("12:15")).toBeInTheDocument();
    expect(
      screen.getAllByRole("article").map((a) => a.getAttribute("aria-label")),
    ).toEqual(["Café", "Almoço", "Jantar"]);
  });

  it("shows no time and keeps the document order when a meal has none", async () => {
    mockFetch({});
    const { db, view } = await setupApp();
    await activate(db, [mealDoc("m1", "Jantar"), mealDoc("m2", "Café")]);
    await setTime(db, "m2", "07:00");
    view(<ProtocolView />);

    await screen.findByRole("article", { name: "Jantar" });
    expect(
      screen.getAllByRole("article").map((a) => a.getAttribute("aria-label")),
    ).toEqual(["Jantar", "Café"]);
    expect(screen.getByText("07:00")).toBeInTheDocument();
    expect(
      within(screen.getByRole("article", { name: "Jantar" })).queryByText(
        /^\d\d:\d\d$/,
      ),
    ).not.toBeInTheDocument();
  });
});
