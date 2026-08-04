export class AssertionCenter {
  private readonly assertions: Array<() => void> = [];

  register(assertion: () => void): void {
    this.assertions.push(assertion);
  }

  assert(): void {
    const failures: string[] = [];
    for (const assertion of this.assertions) {
      try {
        assertion();
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (failures.length > 0) throw new Error(`Environment validation failed:\n${failures.join("\n")}`);
  }
}
