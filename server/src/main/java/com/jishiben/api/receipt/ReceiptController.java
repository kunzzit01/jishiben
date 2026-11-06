package com.jishiben.api.receipt;

import com.jishiben.api.common.ApiException;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * 凭证图片落盘与读取：图片按 UUID 命名存在 app.receipts.dir，接口只回传
 * "receipts/<uuid>.<ext>" 这样的相对路径，正好能塞进 transactions.receipt_path（varchar(512)），
 * 换设备也能取回同一张图。
 */
@RestController
@RequestMapping("/api/receipts")
public class ReceiptController {

    /** 单张图片上限 5 MB；multipart 层在 application.yml 放宽到 6 MB，超限在这里转成 413。 */
    static final long MAX_IMAGE_BYTES = 5L * 1024 * 1024;

    private static final String PATH_PREFIX = "receipts/";
    /** 只接受这些字符的文件名，路径分隔符因此不可能出现在路径变量里。 */
    private static final Pattern SAFE_NAME = Pattern.compile("[A-Za-z0-9._-]+");
    private static final MediaType IMAGE_WEBP = MediaType.parseMediaType("image/webp");
    private static final String IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

    private final Path directory;

    public ReceiptController(@Value("${app.receipts.dir:/data/receipts}") String directory) {
        this.directory = Path.of(directory).toAbsolutePath().normalize();
    }

    /** 需要登录：图片归当前账号的凭证使用，写入后才把返回的 path 存进交易。 */
    @PostMapping
    public Map<String, String> upload(@RequestParam(value = "file", required = false) MultipartFile file)
            throws IOException {
        if (file == null || file.isEmpty()) {
            throw ApiException.validation("A receipt image is required in the 'file' field");
        }
        if (file.getSize() > MAX_IMAGE_BYTES) {
            throw ApiException.payloadTooLarge("Receipt image must be 5 MB or smaller");
        }
        String extension = extensionFor(file.getContentType());
        if (extension == null) {
            throw ApiException.validation("Only image/jpeg, image/png and image/webp receipts are accepted");
        }
        String name = UUID.randomUUID() + "." + extension;
        Files.createDirectories(directory);
        file.transferTo(directory.resolve(name));
        return Map.of("path", PATH_PREFIX + name);
    }

    /** 允许匿名：随机 UUID 文件名不可猜，RN 的 <Image> 也带不了 Authorization 头。 */
    @GetMapping("/{name}")
    public ResponseEntity<Resource> download(@PathVariable String name) {
        Path file = resolve(name);
        return ResponseEntity.ok()
                .contentType(mediaTypeFor(name))
                .header(HttpHeaders.CACHE_CONTROL, IMMUTABLE_CACHE)
                .body(new FileSystemResource(file));
    }

    private Path resolve(String name) {
        // 文件名非法或试图穿越目录，一律 400，不暴露存储位置
        if (!SAFE_NAME.matcher(name).matches() || name.contains("..")) {
            throw ApiException.badRequest("Receipt name is invalid");
        }
        Path file = directory.resolve(name).normalize();
        // 双保险：规范化后仍必须落在存储目录内，且是普通文件
        if (!file.startsWith(directory) || !Files.isRegularFile(file)) {
            throw ApiException.notFound("Receipt not found");
        }
        return file;
    }

    private static String extensionFor(String contentType) {
        if (contentType == null) {
            return null;
        }
        String type = contentType.toLowerCase(Locale.ROOT).trim();
        int parameters = type.indexOf(';');
        if (parameters >= 0) {
            type = type.substring(0, parameters).trim();
        }
        return switch (type) {
            case "image/jpeg" -> "jpg";
            case "image/png" -> "png";
            case "image/webp" -> "webp";
            default -> null;
        };
    }

    private static MediaType mediaTypeFor(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".png")) {
            return MediaType.IMAGE_PNG;
        }
        if (lower.endsWith(".webp")) {
            return IMAGE_WEBP;
        }
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
            return MediaType.IMAGE_JPEG;
        }
        return MediaType.APPLICATION_OCTET_STREAM;
    }
}
