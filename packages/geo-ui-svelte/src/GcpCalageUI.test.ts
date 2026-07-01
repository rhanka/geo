import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import GcpCalageUI, {
  clampUnit,
  containImageBox,
  FULL_CONTAIN_BOX,
  isCompleteGcp,
  isGcpSetReady,
  pdfPointFromContainClick,
  type GcpCalagePoint,
} from "./GcpCalageUI.svelte";

afterEach(cleanup);

const completeGcps: GcpCalagePoint[] = [
  { fx: 0.1, fy: 0.2, lon: -73.1, lat: 45.1, residualM: 1.2 },
  { fx: 0.4, fy: 0.5, lon: -73.2, lat: 45.2, residualM: 2.3 },
  { fx: 0.8, fy: 0.7, lon: -73.3, lat: 45.3, residualM: 3.4 },
];

describe("GcpCalageUI helpers", () => {
  it("clamps PDF fractions to the unit interval", () => {
    expect(clampUnit(-0.25)).toBe(0);
    expect(clampUnit(0.42)).toBe(0.42);
    expect(clampUnit(2)).toBe(1);
    expect(clampUnit(Number.NaN)).toBe(0);
  });

  it("requires enough complete GCPs", () => {
    expect(isCompleteGcp(completeGcps[0]!)).toBe(true);
    expect(isCompleteGcp({ fx: 0.1, fy: 0.2 })).toBe(false);
    expect(isGcpSetReady(completeGcps)).toBe(true);
    expect(isGcpSetReady(completeGcps.slice(0, 2))).toBe(false);
  });
});

describe("containImageBox (object-fit: contain geometry)", () => {
  it("returns the identity box when any dimension is unknown", () => {
    expect(containImageBox(0, 0, 0, 0)).toEqual(FULL_CONTAIN_BOX);
    expect(containImageBox(200, 100, 0, 0)).toEqual(FULL_CONTAIN_BOX);
    expect(containImageBox(200, 100, 100, 0)).toEqual(FULL_CONTAIN_BOX);
  });

  it("pillarboxes a square page inside a landscape frame (bars left/right)", () => {
    // frame 200×100 (aspect 2), page 100×100 (aspect 1): page paints the
    // middle 50% of the width, full height.
    const box = containImageBox(200, 100, 100, 100);
    expect(box.widthFrac).toBeCloseTo(0.5, 6);
    expect(box.offsetXFrac).toBeCloseTo(0.25, 6);
    expect(box.heightFrac).toBe(1);
    expect(box.offsetYFrac).toBe(0);
  });

  it("letterboxes a landscape page inside a portrait frame (bars top/bottom)", () => {
    // frame 100×200 (aspect 0.5), page 100×100 (aspect 1): page paints the
    // middle 50% of the height, full width.
    const box = containImageBox(100, 200, 100, 100);
    expect(box.heightFrac).toBeCloseTo(0.5, 6);
    expect(box.offsetYFrac).toBeCloseTo(0.25, 6);
    expect(box.widthFrac).toBe(1);
    expect(box.offsetXFrac).toBe(0);
  });
});

describe("pdfPointFromContainClick", () => {
  it("passes clicks through unchanged when the page fills the frame", () => {
    expect(pdfPointFromContainClick(0.3, 0.7, FULL_CONTAIN_BOX)).toEqual({
      fx: 0.3,
      fy: 0.7,
    });
  });

  it("removes the pillarbox bars from the horizontal fraction", () => {
    const box = containImageBox(200, 100, 100, 100); // page spans x 0.25…0.75
    // A frame-fraction of 0.3 sits 0.05 into the 0.5-wide page → fx ≈ 0.1
    // (the naive full-frame math would wrongly report 0.3).
    expect(pdfPointFromContainClick(0.3, 0.5, box).fx).toBeCloseTo(0.1, 6);
    // Clicks that fall on a bar clamp to the nearest page edge.
    expect(pdfPointFromContainClick(0.1, 0.5, box).fx).toBe(0);
    expect(pdfPointFromContainClick(0.9, 0.5, box).fx).toBe(1);
  });
});

describe("GcpCalageUI", () => {
  it("emits a fractional PDF point from the page click target", async () => {
    const onPdfPoint = vi.fn();
    const { getByLabelText } = render(GcpCalageUI, {
      props: {
        imageUrl: "/plan.png",
        mapEnabled: false,
        onPdfPoint,
      },
    });

    const hit = getByLabelText("Placer un point PDF") as HTMLElement;
    hit.getBoundingClientRect = () =>
      ({
        left: 10,
        top: 20,
        width: 200,
        height: 100,
        right: 210,
        bottom: 120,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;

    await fireEvent.click(hit, { clientX: 110, clientY: 70 });
    expect(onPdfPoint).toHaveBeenCalledWith({ fx: 0.5, fy: 0.5 });
  });

  it("normalizes the PDF click against the letterboxed page, not the full frame", async () => {
    const onPdfPoint = vi.fn();
    const { getByLabelText, container } = render(GcpCalageUI, {
      props: { imageUrl: "/plan.png", mapEnabled: false, onPdfPoint },
    });

    // A square 100×100 page inside a 200×100 landscape frame → pillarbox bars;
    // the page paints across the middle 50% of the width (x 0.25 … 0.75).
    const image = container.querySelector(
      "img.gcp-page-image",
    ) as HTMLImageElement;
    Object.defineProperty(image, "naturalWidth", {
      value: 100,
      configurable: true,
    });
    Object.defineProperty(image, "naturalHeight", {
      value: 100,
      configurable: true,
    });

    const hit = getByLabelText("Placer un point PDF") as HTMLElement;
    hit.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 200,
        height: 100,
        right: 200,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    // Click at frame x=60 (0.3 of the frame). The buggy full-frame math emits
    // fx 0.3; the contain-aware fix removes the 25% bar → fx ≈ 0.1.
    await fireEvent.click(hit, { clientX: 60, clientY: 50 });
    expect(onPdfPoint).toHaveBeenCalledTimes(1);
    const emitted = onPdfPoint.mock.calls[0]![0] as { fx: number; fy: number };
    expect(emitted.fx).toBeCloseTo(0.1, 6);
    expect(emitted.fx).not.toBeCloseTo(0.3, 6);
    expect(emitted.fy).toBeCloseTo(0.5, 6);
  });

  it("disables compute until three complete GCPs are present", async () => {
    const onCompute = vi.fn();
    const { getByRole, rerender } = render(GcpCalageUI, {
      props: {
        mapEnabled: false,
        gcps: completeGcps.slice(0, 2),
        onCompute,
      },
    });

    const compute = getByRole("button", { name: "Calculer" });
    expect((compute as HTMLButtonElement).disabled).toBe(true);

    await rerender({
      mapEnabled: false,
      gcps: completeGcps,
      onCompute,
    });
    expect((compute as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(compute);
    expect(onCompute).toHaveBeenCalledTimes(1);
  });

  it("renders residual report values and action callbacks", async () => {
    const onUndo = vi.fn();
    const onClear = vi.fn();
    const { getByText, getByRole } = render(GcpCalageUI, {
      props: {
        mapEnabled: false,
        gcps: completeGcps,
        report: { maxResidualM: 12.4, rmsResidualM: 4.2 },
        onUndo,
        onClear,
      },
    });

    expect(getByText("Résidu max 12.4 m")).toBeTruthy();
    expect(getByText("4.2 m")).toBeTruthy();

    await fireEvent.click(getByRole("button", { name: "Annuler" }));
    await fireEvent.click(getByRole("button", { name: "Effacer" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
