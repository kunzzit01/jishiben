package com.jishiben.api.paymentplan;

import com.jishiben.api.common.Timestamps;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A recurring monthly fixed expense/income plan. It lived only in AsyncStorage before, so switching
 * devices lost the whole financial plan; it is server-side now.
 */
@Entity
@Table(name = "payment_plans")
public class PaymentPlan {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long ownerId;

    @Column(name = "client_uid", nullable = false, length = 64)
    private String clientUid;

    @Column(name = "ledger_id", nullable = false)
    private Long ledgerId;

    @Column(name = "category_id")
    private Long categoryId;

    @Column(name = "asset_id")
    private Long assetId;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false, columnDefinition = "decimal(19,4)")
    private BigDecimal amount;

    @Column(nullable = false, length = 16)
    private String type;

    @Column(nullable = false, length = 16)
    private String cycle;

    @JdbcTypeCode(SqlTypes.TINYINT)
    @Column(name = "day_of_week", columnDefinition = "tinyint unsigned")
    private Short dayOfWeek;

    @JdbcTypeCode(SqlTypes.TINYINT)
    @Column(name = "day_of_month", columnDefinition = "tinyint unsigned")
    private Short dayOfMonth;

    @JdbcTypeCode(SqlTypes.TINYINT)
    @Column(name = "month_of_year", columnDefinition = "tinyint unsigned")
    private Short monthOfYear;

    @JdbcTypeCode(SqlTypes.TINYINT)
    @Column(name = "day", columnDefinition = "tinyint unsigned")
    private Short day;

    @Column(name = "start_date", nullable = false, columnDefinition = "date")
    private LocalDate startDate;

    @Column(name = "end_date", columnDefinition = "date")
    private LocalDate endDate;

    @Column(name = "auto_deduct", nullable = false)
    private boolean autoDeduct = true;

    /** Catch-up cursor; the client engine stops after 24 occurrences. */
    @Column(name = "last_processed_date", columnDefinition = "date")
    private LocalDate lastProcessedDate;

    @Column(nullable = false)
    private boolean active = true;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @Column(name = "archived_at", columnDefinition = "datetime")
    private Instant archivedAt;

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

    public String getClientUid() {
        return clientUid;
    }

    public void setClientUid(String clientUid) {
        this.clientUid = clientUid;
    }

    public Long getLedgerId() {
        return ledgerId;
    }

    public void setLedgerId(Long ledgerId) {
        this.ledgerId = ledgerId;
    }

    public Long getCategoryId() {
        return categoryId;
    }

    public void setCategoryId(Long categoryId) {
        this.categoryId = categoryId;
    }

    public Long getAssetId() {
        return assetId;
    }

    public void setAssetId(Long assetId) {
        this.assetId = assetId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public void setAmount(BigDecimal amount) {
        this.amount = amount;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getCycle() {
        return cycle;
    }

    public void setCycle(String cycle) {
        this.cycle = cycle;
    }

    public Short getDayOfWeek() {
        return dayOfWeek;
    }

    public void setDayOfWeek(Short dayOfWeek) {
        this.dayOfWeek = dayOfWeek;
    }

    public Short getDayOfMonth() {
        return dayOfMonth;
    }

    public void setDayOfMonth(Short dayOfMonth) {
        this.dayOfMonth = dayOfMonth;
    }

    public Short getMonthOfYear() {
        return monthOfYear;
    }

    public void setMonthOfYear(Short monthOfYear) {
        this.monthOfYear = monthOfYear;
    }

    public Short getDay() {
        return day;
    }

    public void setDay(Short day) {
        this.day = day;
    }

    public LocalDate getStartDate() {
        return startDate;
    }

    public void setStartDate(LocalDate startDate) {
        this.startDate = startDate;
    }

    public LocalDate getEndDate() {
        return endDate;
    }

    public void setEndDate(LocalDate endDate) {
        this.endDate = endDate;
    }

    public boolean isAutoDeduct() {
        return autoDeduct;
    }

    public void setAutoDeduct(boolean autoDeduct) {
        this.autoDeduct = autoDeduct;
    }

    public LocalDate getLastProcessedDate() {
        return lastProcessedDate;
    }

    public void setLastProcessedDate(LocalDate lastProcessedDate) {
        this.lastProcessedDate = lastProcessedDate;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }

    public int getSortOrder() {
        return sortOrder;
    }

    public void setSortOrder(int sortOrder) {
        this.sortOrder = sortOrder;
    }

    public Instant getArchivedAt() {
        return archivedAt;
    }

    public void setArchivedAt(Instant archivedAt) {
        this.archivedAt = archivedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
