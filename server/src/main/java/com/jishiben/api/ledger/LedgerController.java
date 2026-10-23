package com.jishiben.api.ledger;

import com.jishiben.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
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
@RequestMapping("/api/ledgers")
public class LedgerController {

    private final LedgerService ledgers;

    public LedgerController(LedgerService ledgers) {
        this.ledgers = ledgers;
    }

    @GetMapping
    public List<LedgerDtos.Response> list(@RequestParam(defaultValue = "false") boolean includeArchived) {
        return ledgers.list(CurrentUser.id(), includeArchived);
    }

    @GetMapping("/{clientUid}")
    public LedgerDtos.Response get(@PathVariable String clientUid) {
        return ledgers.get(CurrentUser.id(), clientUid);
    }

    @PutMapping
    @ResponseStatus(HttpStatus.OK)
    public LedgerDtos.Response upsert(@Valid @RequestBody LedgerDtos.UpsertRequest request) {
        return ledgers.upsert(CurrentUser.id(), request);
    }

    @PatchMapping("/{clientUid}")
    public LedgerDtos.Response patch(@PathVariable String clientUid,
                                     @Valid @RequestBody LedgerDtos.PatchRequest request) {
        return ledgers.patch(CurrentUser.id(), clientUid, request);
    }

    @DeleteMapping("/{clientUid}")
    public LedgerDtos.DeleteResult delete(@PathVariable String clientUid,
                                          @RequestParam(defaultValue = "false") boolean force) {
        return ledgers.delete(CurrentUser.id(), clientUid, force);
    }
}
