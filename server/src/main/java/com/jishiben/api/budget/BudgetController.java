package com.jishiben.api.budget;

import com.jishiben.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/budgets")
public class BudgetController {

    private final BudgetService budgets;

    public BudgetController(BudgetService budgets) {
        this.budgets = budgets;
    }

    @GetMapping
    public List<BudgetDtos.Response> list(@RequestParam(required = false) String currency) {
        return budgets.list(CurrentUser.id(), currency);
    }

    @PutMapping
    public BudgetDtos.Response upsert(@Valid @RequestBody BudgetDtos.UpsertRequest request) {
        return budgets.upsert(CurrentUser.id(), request);
    }

    @DeleteMapping("/{clientUid}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String clientUid) {
        budgets.delete(CurrentUser.id(), clientUid);
    }
}
