package com.jishiben.api.paymentplan;

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
@RequestMapping("/api/payment-plans")
public class PaymentPlanController {

    private final PaymentPlanService plans;

    public PaymentPlanController(PaymentPlanService plans) {
        this.plans = plans;
    }

    @GetMapping
    public List<PaymentPlanDtos.Response> list(@RequestParam(defaultValue = "false") boolean includeArchived) {
        return plans.list(CurrentUser.id(), includeArchived);
    }

    @GetMapping("/{clientUid}")
    public PaymentPlanDtos.Response get(@PathVariable String clientUid) {
        return plans.get(CurrentUser.id(), clientUid);
    }

    @PutMapping
    public PaymentPlanDtos.Response upsert(@Valid @RequestBody PaymentPlanDtos.UpsertRequest request) {
        return plans.upsert(CurrentUser.id(), request);
    }

    @PatchMapping("/{clientUid}")
    public PaymentPlanDtos.Response patch(@PathVariable String clientUid,
                                          @Valid @RequestBody PaymentPlanDtos.PatchRequest request) {
        return plans.patch(CurrentUser.id(), clientUid, request);
    }

    @DeleteMapping("/{clientUid}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String clientUid) {
        plans.delete(CurrentUser.id(), clientUid);
    }
}
