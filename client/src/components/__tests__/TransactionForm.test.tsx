import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TransactionForm, type NewTransaction } from "../TransactionForm";

afterEach(cleanup);

describe("TransactionForm", () => {
  test("submits a valid expense as a negative amount", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TransactionForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Description"), "Coffee shop");
    await user.type(screen.getByLabelText("Amount"), "4.50");
    await user.click(screen.getByRole("button", { name: "Add it!" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0][0] as NewTransaction;
    expect(submitted.description).toBe("Coffee shop");
    expect(submitted.amount_cents).toBe(-450);
    expect(submitted.category).toBe("Uncategorized");
  });

  test("submits income as a positive amount after toggling the type", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TransactionForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Description"), "Paycheck");
    await user.type(screen.getByLabelText("Amount"), "1000");
    await user.click(screen.getByRole("button", { name: "💰 earned" }));
    await user.click(screen.getByRole("button", { name: "Add it!" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0][0] as NewTransaction;
    expect(submitted.amount_cents).toBe(100000);
  });

  test("shows a validation error and does not submit when description is empty", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TransactionForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Amount"), "10");
    await user.click(screen.getByRole("button", { name: "Add it!" }));

    expect(await screen.findByText("Give it a name")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("shows a validation error and does not submit when the amount is invalid", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TransactionForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Description"), "Mystery charge");
    await user.type(screen.getByLabelText("Amount"), "not-a-number");
    await user.click(screen.getByRole("button", { name: "Add it!" }));

    expect(await screen.findByText("A positive amount, up to 2 decimals")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("clears description and amount after a successful submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TransactionForm onSubmit={onSubmit} />);

    const description = screen.getByLabelText("Description") as HTMLInputElement;
    const amount = screen.getByLabelText("Amount") as HTMLInputElement;
    await user.type(description, "One-off");
    await user.type(amount, "5");
    await user.click(screen.getByRole("button", { name: "Add it!" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(description.value).toBe("");
    expect(amount.value).toBe("");
  });
});
