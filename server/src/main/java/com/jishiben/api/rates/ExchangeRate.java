package com.jishiben.api.rates;

import com.jishiben.api.common.Timestamps;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 24h cache of upstream reference rates, one row per base currency. The payload stays raw JSON so a
 * new currency needs no migration. Rates that participate in arithmetic never come from here; those
 * live on the transaction as DECIMAL(19,8).
 */
@Entity
@Table(name = "exchange_rates")
public class ExchangeRate {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(nullable = false, length = 3)
    private String base;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "json")
    private JsonNode rates;

    @Column(name = "fetched_at", nullable = false, columnDefinition = "datetime")
    private Instant fetchedAt;

    @Column(name = "created_at", nullable = false, columnDefinition = "datetime")
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, columnDefinition = "datetime")
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Timestamps.now();
        if (createdAt == null) {
            createdAt = now;
        }
        if (fetchedAt == null) {
            fetchedAt = now;
        }
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Timestamps.now();
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getBase() {
        return base;
    }

    public void setBase(String base) {
        this.base = base;
    }

    public JsonNode getRates() {
        return rates;
    }

    public void setRates(JsonNode rates) {
        this.rates = rates;
    }

    public Instant getFetchedAt() {
        return fetchedAt;
    }

    public void setFetchedAt(Instant fetchedAt) {
        this.fetchedAt = fetchedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
