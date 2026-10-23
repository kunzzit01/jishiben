package com.jishiben.api.transaction;

import com.jishiben.api.common.PageResponse;
import com.jishiben.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/transactions")
public class TransactionController {

    private final TransactionService transactions;

    public TransactionController(TransactionService transactions) {
        this.transactions = transactions;
    }

    @GetMapping
    public PageResponse<TransactionDtos.Response> list(
            @RequestParam(required = false) String ledgerUid,
            @RequestParam(required = false) String categoryUid,
            @RequestParam(required = false) String assetUid,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return transactions.list(CurrentUser.id(), ledgerUid, categoryUid, assetUid, type, from, to, page, size);
    }

    @GetMapping("/{clientUid}")
    public TransactionDtos.Response get(@PathVariable String clientUid) {
        return transactions.get(CurrentUser.id(), clientUid);
    }

    @PutMapping
    public TransactionDtos.Response upsert(@Valid @RequestBody TransactionDtos.UpsertRequest request) {
        return transactions.upsert(CurrentUser.id(), request);
    }

    @PatchMapping("/{clientUid}")
    public TransactionDtos.Response patch(@PathVariable String clientUid,
                                          @Valid @RequestBody TransactionDtos.PatchRequest request) {
        return transactions.patch(CurrentUser.id(), clientUid, request);
    }

    @DeleteMapping("/{clientUid}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String clientUid) {
        transactions.delete(CurrentUser.id(), clientUid);
    }
}
