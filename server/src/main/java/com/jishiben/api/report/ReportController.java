package com.jishiben.api.report;

import com.jishiben.api.security.CurrentUser;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/reports")
public class ReportController {

    private final ReportService reports;

    public ReportController(ReportService reports) {
        this.reports = reports;
    }

    /** Income/expense per currency (transfers excluded). Defaults to the current month. */
    @GetMapping("/summary")
    public ReportDtos.Summary summary(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) String currency) {
        return reports.summary(CurrentUser.id(), from, to, currency);
    }

    /** Account balances plus per-currency totals; never one blended net worth across currencies. */
    @GetMapping("/asset-balances")
    public ReportDtos.AssetBalances assetBalances() {
        return reports.assetBalances(CurrentUser.id());
    }
}
