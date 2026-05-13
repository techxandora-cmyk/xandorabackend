const { loadCatalogItem, validateRetailScan } = require("../api/routes/lib/retailValidation");

describe("retailValidation auto-mapped catalog handling", () => {
  it("ignores auto-mapped catalog rows during catalog lookup", async () => {
    const db = {
      query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    };

    const item = await loadCatalogItem(db, "COLOMBO_01", "EPC-001");

    expect(item).toBeNull();
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("LOWER(COALESCE(metadata->>'auto_mapped', 'false')) <> 'true'"),
      ["COLOMBO_01", "EPC-001"]
    );
  });

  it("treats auto-mapped catalog rows as unknown EPCs", async () => {
    const db = {
      query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    };

    const result = await validateRetailScan(db, {
      store_id: "COLOMBO_01",
      epc: "epc-001",
    });

    expect(result.validation_status).toBe("UNKNOWN_EPC");
    expect(result.catalog_item).toBeNull();
  });
});
