package com.jishiben.api.profile;

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

/** One row per account: the account-level display settings. */
@Entity
@Table(name = "profiles")
public class Profile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false, unique = true)
    private Long ownerId;

    @Column(name = "display_name", length = 100)
    private String displayName;

    /** Fallback currency for amounts that carry no account of their own. */
    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(nullable = false, length = 3)
    private String currency = "MYR";

    @Column(name = "date_format", nullable = false, length = 20)
    private String dateFormat = "YYYY/MM/DD";

    @JdbcTypeCode(SqlTypes.TINYINT)
    @Column(name = "week_starts_on", nullable = false, columnDefinition = "tinyint unsigned")
    private Short weekStartsOn = 1;

    @JdbcTypeCode(SqlTypes.TINYINT)
    @Column(name = "decimal_places", nullable = false, columnDefinition = "tinyint unsigned")
    private Short decimalPlaces = 2;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "period_preference", columnDefinition = "json")
    private JsonNode periodPreference;

    @Column(name = "active_ledger_id")
    private Long activeLedgerId;

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

    public Long getOwnerId() {
        return ownerId;
    }

    public void setOwnerId(Long ownerId) {
        this.ownerId = ownerId;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public String getCurrency() {
        return currency;
    }

    public void setCurrency(String currency) {
        this.currency = currency;
    }

    public String getDateFormat() {
        return dateFormat;
    }

    public void setDateFormat(String dateFormat) {
        this.dateFormat = dateFormat;
    }

    public Short getWeekStartsOn() {
        return weekStartsOn;
    }

    public void setWeekStartsOn(Short weekStartsOn) {
        this.weekStartsOn = weekStartsOn;
    }

    public Short getDecimalPlaces() {
        return decimalPlaces;
    }

    public void setDecimalPlaces(Short decimalPlaces) {
        this.decimalPlaces = decimalPlaces;
    }

    public JsonNode getPeriodPreference() {
        return periodPreference;
    }

    public void setPeriodPreference(JsonNode periodPreference) {
        this.periodPreference = periodPreference;
    }

    public Long getActiveLedgerId() {
        return activeLedgerId;
    }

    public void setActiveLedgerId(Long activeLedgerId) {
        this.activeLedgerId = activeLedgerId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
