package com.jishiben.api.asset;

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
@RequestMapping("/api/assets")
public class AssetController {

    private final AssetService assets;

    public AssetController(AssetService assets) {
        this.assets = assets;
    }

    @GetMapping
    public List<AssetDtos.Response> list(@RequestParam(required = false) String ledgerUid,
                                         @RequestParam(defaultValue = "false") boolean includeArchived) {
        return assets.list(CurrentUser.id(), ledgerUid, includeArchived);
    }

    @GetMapping("/{clientUid}")
    public AssetDtos.Response get(@PathVariable String clientUid) {
        return assets.get(CurrentUser.id(), clientUid);
    }

    @PutMapping
    public AssetDtos.Response upsert(@Valid @RequestBody AssetDtos.UpsertRequest request) {
        return assets.upsert(CurrentUser.id(), request);
    }

    @PatchMapping("/{clientUid}")
    public AssetDtos.Response patch(@PathVariable String clientUid,
                                    @Valid @RequestBody AssetDtos.PatchRequest request) {
        return assets.patch(CurrentUser.id(), clientUid, request);
    }

    @DeleteMapping("/{clientUid}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String clientUid) {
        assets.delete(CurrentUser.id(), clientUid);
    }
}
